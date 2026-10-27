//! Verification of the `x-amzn-oidc-data` header added by the ALB
//! `authenticate-oidc` action.
//!
//! The ALB signs the user claims with ES256 and a per-region key it publishes
//! at a well-known URL. Two ALB quirks mean an off-the-shelf JWT library is
//! not a good fit:
//!
//! * `exp`, `signer` and `kid` live in the JWT *header*, not the payload.
//! * Segments are base64url *with* padding, which strict decoders reject.
//!
//! See <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-authenticate-users.html#user-claims-encoding>.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use base64::Engine;
use base64::alphabet::URL_SAFE;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use p256::pkcs8::DecodePublicKey;
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::model::CurrentUser;

/// base64url that accepts both padded (ALB) and unpadded segments.
const BASE64URL: GeneralPurpose = GeneralPurpose::new(
    &URL_SAFE,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

/// Tolerated clock skew between the ALB and this task.
const EXP_LEEWAY_SECS: i64 = 30;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum AuthError {
    #[error("token is not a three-part JWT")]
    Malformed,
    #[error("unsupported algorithm {0:?}")]
    UnsupportedAlgorithm(String),
    #[error("token was signed by {0:?}, not this load balancer")]
    WrongSigner(String),
    #[error("token expired")]
    Expired,
    #[error("key id is not a safe identifier")]
    UnsafeKeyId,
    #[error("could not obtain public key: {0}")]
    KeyUnavailable(String),
    #[error("signature verification failed")]
    BadSignature,
    #[error("claims are missing `sub`")]
    MissingSubject,
}

#[derive(Deserialize)]
struct AlbJwtHeader {
    alg: String,
    kid: String,
    signer: String,
    exp: i64,
}

#[derive(Deserialize)]
struct AlbClaims {
    sub: Option<String>,
    email: Option<String>,
    name: Option<String>,
    #[serde(default)]
    groups: Vec<String>,
}

/// URL of the ALB public key for `kid`. GovCloud publishes keys in S3 rather
/// than on the `public-keys.auth.elb` hostname used by commercial regions.
pub fn public_key_url(region: &str, kid: &str) -> String {
    if region.starts_with("us-gov-") {
        format!("https://s3-{region}.amazonaws.com/aws-elb-public-keys-prod-{region}/{kid}")
    } else {
        format!("https://public-keys.auth.elb.{region}.amazonaws.com/{kid}")
    }
}

/// `kid` comes from an untrusted header and is interpolated into a URL, so
/// only allow the characters AWS actually uses (UUID-style identifiers).
fn is_safe_key_id(kid: &str) -> bool {
    (1..=128).contains(&kid.len()) && kid.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Source of PEM-encoded ALB public keys. Abstracted so tests need no network.
#[async_trait]
pub trait KeyFetcher: Send + Sync {
    async fn fetch_pem(&self, kid: &str) -> Result<String, AuthError>;
}

/// Fetches keys from the regional ALB key endpoint.
pub struct HttpKeyFetcher {
    client: reqwest::Client,
    region: String,
}

impl HttpKeyFetcher {
    pub fn new(region: impl Into<String>) -> reqwest::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()?;
        Ok(Self {
            client,
            region: region.into(),
        })
    }
}

#[async_trait]
impl KeyFetcher for HttpKeyFetcher {
    async fn fetch_pem(&self, kid: &str) -> Result<String, AuthError> {
        let unavailable = |e: reqwest::Error| AuthError::KeyUnavailable(e.to_string());
        self.client
            .get(public_key_url(&self.region, kid))
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(unavailable)?
            .text()
            .await
            .map_err(unavailable)
    }
}

/// Verifies ALB identity tokens for one specific load balancer.
pub struct AlbTokenVerifier {
    expected_signer: String,
    fetcher: Arc<dyn KeyFetcher>,
    /// Keys never change for a given `kid`, so successful fetches are cached forever.
    keys: RwLock<HashMap<String, VerifyingKey>>,
}

impl AlbTokenVerifier {
    pub fn new(expected_signer: impl Into<String>, fetcher: Arc<dyn KeyFetcher>) -> Self {
        Self {
            expected_signer: expected_signer.into(),
            fetcher,
            keys: RwLock::default(),
        }
    }

    pub async fn verify(&self, token: &str) -> Result<CurrentUser, AuthError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        self.verify_at(token, now).await
    }

    /// Verifies `token` as of `now` (Unix seconds).
    pub async fn verify_at(&self, token: &str, now: i64) -> Result<CurrentUser, AuthError> {
        let [header_b64, payload_b64, signature_b64] = split_jwt(token)?;
        let header: AlbJwtHeader = decode_json(header_b64)?;

        // Cheap checks first. All of them, and the signature, must pass.
        if header.alg != "ES256" {
            return Err(AuthError::UnsupportedAlgorithm(header.alg));
        }
        if header.signer != self.expected_signer {
            return Err(AuthError::WrongSigner(header.signer));
        }
        if now > header.exp + EXP_LEEWAY_SECS {
            return Err(AuthError::Expired);
        }
        if !is_safe_key_id(&header.kid) {
            return Err(AuthError::UnsafeKeyId);
        }

        // ES256 JWS signatures are the raw 64-byte r||s pair, computed over the
        // segments exactly as transmitted (padding included).
        let key = self.key(&header.kid).await?;
        let signature_bytes = BASE64URL
            .decode(signature_b64)
            .map_err(|_| AuthError::Malformed)?;
        let signature =
            Signature::from_slice(&signature_bytes).map_err(|_| AuthError::BadSignature)?;
        let signing_input = &token[..header_b64.len() + 1 + payload_b64.len()];
        key.verify(signing_input.as_bytes(), &signature)
            .map_err(|_| AuthError::BadSignature)?;

        let claims: AlbClaims = decode_json(payload_b64)?;
        Ok(CurrentUser {
            sub: claims.sub.ok_or(AuthError::MissingSubject)?,
            email: claims.email,
            name: claims.name,
            groups: claims.groups,
        })
    }

    async fn key(&self, kid: &str) -> Result<VerifyingKey, AuthError> {
        if let Some(key) = self.keys.read().await.get(kid) {
            return Ok(*key);
        }
        let pem = self.fetcher.fetch_pem(kid).await?;
        let key = VerifyingKey::from_public_key_pem(pem.trim())
            .map_err(|e| AuthError::KeyUnavailable(format!("invalid PEM: {e}")))?;
        self.keys.write().await.insert(kid.to_owned(), key);
        Ok(key)
    }
}

fn split_jwt(token: &str) -> Result<[&str; 3], AuthError> {
    let mut parts = token.split('.');
    match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(h), Some(p), Some(s), None) => Ok([h, p, s]),
        _ => Err(AuthError::Malformed),
    }
}

fn decode_json<T: serde::de::DeserializeOwned>(segment: &str) -> Result<T, AuthError> {
    let bytes = BASE64URL
        .decode(segment)
        .map_err(|_| AuthError::Malformed)?;
    serde_json::from_slice(&bytes).map_err(|_| AuthError::Malformed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE as PADDED_BASE64URL;
    use p256::ecdsa::SigningKey;
    use p256::ecdsa::signature::Signer;
    use p256::elliptic_curve::Generate;
    use p256::pkcs8::{EncodePublicKey, LineEnding};
    use serde_json::json;

    const ALB_ARN: &str = "arn:aws-us-gov:elasticloadbalancing:us-gov-west-1:111111111111:loadbalancer/app/govcloud-mfe/0123456789abcdef";
    const KID: &str = "4c3a9e1b-2f7d-4a61-9b8e-0d5c6f7a8b9c";
    const NOW: i64 = 1_800_000_000;

    struct StaticKey(String);

    #[async_trait]
    impl KeyFetcher for StaticKey {
        async fn fetch_pem(&self, _kid: &str) -> Result<String, AuthError> {
            Ok(self.0.clone())
        }
    }

    fn verifier_for(key: &SigningKey) -> AlbTokenVerifier {
        let pem = key
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .unwrap();
        AlbTokenVerifier::new(ALB_ARN, Arc::new(StaticKey(pem)))
    }

    /// Builds a token the way the ALB does: padded base64url segments.
    fn alb_token(key: &SigningKey, header: serde_json::Value) -> String {
        let claims =
            json!({ "sub": "user-123", "email": "jane@example.gov", "groups": ["analysts"] });
        let signing_input = format!(
            "{}.{}",
            PADDED_BASE64URL.encode(header.to_string()),
            PADDED_BASE64URL.encode(claims.to_string())
        );
        let signature: Signature = key.sign(signing_input.as_bytes());
        format!(
            "{signing_input}.{}",
            PADDED_BASE64URL.encode(signature.to_bytes())
        )
    }

    fn header(signer: &str, exp: i64, kid: &str) -> serde_json::Value {
        json!({ "alg": "ES256", "kid": kid, "signer": signer, "exp": exp, "iss": "https://idp", "client": "c" })
    }

    #[tokio::test]
    async fn accepts_a_valid_padded_token() {
        let key = SigningKey::generate();
        let token = alb_token(&key, header(ALB_ARN, NOW + 60, KID));
        assert!(token.contains('='), "fixture should exercise padding");

        let user = verifier_for(&key).verify_at(&token, NOW).await.unwrap();
        assert_eq!(user.sub, "user-123");
        assert_eq!(user.email.as_deref(), Some("jane@example.gov"));
        assert_eq!(user.groups, vec!["analysts"]);
    }

    #[tokio::test]
    async fn rejects_a_token_from_another_load_balancer() {
        let key = SigningKey::generate();
        let token = alb_token(
            &key,
            header("arn:aws-us-gov:elasticloadbalancing:other", NOW + 60, KID),
        );
        let err = verifier_for(&key).verify_at(&token, NOW).await.unwrap_err();
        assert!(matches!(err, AuthError::WrongSigner(_)));
    }

    #[tokio::test]
    async fn rejects_an_expired_token() {
        let key = SigningKey::generate();
        let token = alb_token(&key, header(ALB_ARN, NOW - EXP_LEEWAY_SECS - 1, KID));
        let err = verifier_for(&key).verify_at(&token, NOW).await.unwrap_err();
        assert_eq!(err, AuthError::Expired);
    }

    #[tokio::test]
    async fn rejects_a_signature_from_a_different_key() {
        let token = alb_token(&SigningKey::generate(), header(ALB_ARN, NOW + 60, KID));
        let err = verifier_for(&SigningKey::generate())
            .verify_at(&token, NOW)
            .await
            .unwrap_err();
        assert_eq!(err, AuthError::BadSignature);
    }

    #[tokio::test]
    async fn rejects_tampered_claims() {
        let key = SigningKey::generate();
        let token = alb_token(&key, header(ALB_ARN, NOW + 60, KID));
        let mut parts: Vec<&str> = token.split('.').collect();
        let forged = PADDED_BASE64URL.encode(json!({ "sub": "admin" }).to_string());
        parts[1] = &forged;
        let err = verifier_for(&key)
            .verify_at(&parts.join("."), NOW)
            .await
            .unwrap_err();
        assert_eq!(err, AuthError::BadSignature);
    }

    #[tokio::test]
    async fn rejects_an_unsafe_key_id_before_fetching() {
        let key = SigningKey::generate();
        let token = alb_token(&key, header(ALB_ARN, NOW + 60, "../../evil?x="));
        let err = verifier_for(&key).verify_at(&token, NOW).await.unwrap_err();
        assert_eq!(err, AuthError::UnsafeKeyId);
    }

    #[tokio::test]
    async fn rejects_garbage() {
        let verifier = verifier_for(&SigningKey::generate());
        assert_eq!(
            verifier.verify_at("not-a-jwt", NOW).await,
            Err(AuthError::Malformed)
        );
        assert_eq!(
            verifier.verify_at("a.b.c.d", NOW).await,
            Err(AuthError::Malformed)
        );
    }

    #[test]
    fn key_url_uses_the_govcloud_s3_endpoint() {
        assert_eq!(
            public_key_url("us-gov-west-1", KID),
            format!(
                "https://s3-us-gov-west-1.amazonaws.com/aws-elb-public-keys-prod-us-gov-west-1/{KID}"
            )
        );
        assert_eq!(
            public_key_url("us-gov-east-1", KID),
            format!(
                "https://s3-us-gov-east-1.amazonaws.com/aws-elb-public-keys-prod-us-gov-east-1/{KID}"
            )
        );
    }

    #[test]
    fn key_url_uses_the_elb_endpoint_in_commercial_regions() {
        assert_eq!(
            public_key_url("us-east-1", KID),
            format!("https://public-keys.auth.elb.us-east-1.amazonaws.com/{KID}")
        );
    }
}
