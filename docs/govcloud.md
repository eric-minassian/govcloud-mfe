# AWS GovCloud (US) notes

Things that differ from commercial AWS and shaped this design.

| Topic | What's different | What we do |
| ----- | ---------------- | ---------- |
| CDN | No CloudFront, so no Lambda@Edge, signed cookies or OAC | ALB + `authenticate-oidc` in front of nginx on Fargate ([ADR 0002](adr/0002-alb-oidc-and-nginx-s3-origin.md)) |
| ARNs | Partition is `aws-us-gov` | CDK uses `Aws.PARTITION` / `Stack.of(this).partition`. Nothing hardcodes `arn:aws:` |
| ALB identity header keys | Public keys for verifying `x-amzn-oidc-data` are **not** at `public-keys.auth.elb.<region>.amazonaws.com`. They are at `https://s3-us-gov-west-1.amazonaws.com/aws-elb-public-keys-prod-us-gov-west-1/<kid>` (and the `us-gov-east-1` equivalent) | `services/frontend-api/src/auth` picks the URL by region. Because it's an S3 URL, tasks fetch it through the S3 gateway endpoint, so no NAT is needed |
| ALB + Cognito | The `authenticate-cognito` action isn't offered in GovCloud regions | `authenticate-oidc` against the agency IdP (Okta, Entra ID Gov, Login.gov, Ping…) |
| CodeConnections | Only available in **GovCloud (US-East)**. Connections can't be used across regions | The tooling account (pipelines) defaults to `us-gov-east-1`, and deploy steps reach stage accounts in any region from CodeBuild. Alternatively, use an S3 or CodeCommit source in US-West |
| CodePipeline | No custom actions. The AppConfig deploy action is CLI-only. No cross-region actions | Deploy logic and the prod bake run in CodeBuild (`cdk deploy`, `release deploy`, alarm polling), assuming roles in the stage account |
| Container images | Tasks in isolated subnets can't reach Docker Hub or ECR Public | Mirror `nginx-unprivileged`, the AppConfig Agent and base images to private ECR and pin by digest. CDK image assets already go to the bootstrap ECR repo |
| FIPS | FIPS 140-2/3 endpoints are expected for many workloads | ALB uses a FIPS TLS policy. nginx's S3 host is configurable (`s3-fips.<region>.amazonaws.com`). The AWS SDKs honour `AWS_USE_FIPS_ENDPOINT=true` |
| AppConfig | Available, including feature flags and the Agent | One application per app ([ADR 0003](adr/0003-appconfig-application-per-app.md)) |
| ELB access logs | The log-delivery principal is region specific | CDK's `logAccessLogs` resolves it for GovCloud regions |

## Before a real deployment

- Choose the source integration your boundary allows (CodeConnections in US-East, CodeCommit, or
  an S3 drop from an on-prem CI).
- Register the ALB callback `https://<domain>/oauth2/idpresponse` with the IdP. The IdP's DNS
  must be publicly resolvable and its token and user-info endpoints reachable from the ALB.
- Store the OIDC client secret in Secrets Manager and set `oidc.clientSecretArn`.
- Replace the in-memory preferences store with DynamoDB.
- Decide on session length. The ALB session timeout is 8 hours here. Many ATOs require
  shorter idle timeouts, which the IdP enforces.
- Add AWS WAF to the ALB (available in GovCloud).
