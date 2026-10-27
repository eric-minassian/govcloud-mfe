import { Duration, SecretValue } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { OidcConfig } from '../config';
import { SESSION_COOKIE_NAME } from '../naming';

export interface AuthenticatedLoadBalancerProps {
  readonly vpc: ec2.IVpc;
  readonly internetFacing: boolean;
  readonly certificateArn: string;
  readonly oidc: OidcConfig;
  readonly accessLogsBucket: s3.IBucket;
}

/**
 * An HTTPS-only ALB that authenticates users against an OIDC IdP before forwarding anything —
 * including static assets. The ALB performs the code flow, keeps the session in an encrypted
 * cookie, and passes a signed `x-amzn-oidc-data` JWT to targets.
 *
 * Routing is left to the caller via `listener` and `authenticated()`.
 */
export class AuthenticatedLoadBalancer extends Construct {
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  readonly listener: elbv2.ApplicationListener;
  private readonly oidc: OidcConfig;

  constructor(scope: Construct, id: string, props: AuthenticatedLoadBalancerProps) {
    super(scope, id);
    this.oidc = props.oidc;

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc: props.vpc,
      internetFacing: props.internetFacing,
      vpcSubnets: {
        subnetType: props.internetFacing ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_ISOLATED,
      },
      // Request-smuggling defences: drop malformed header names, reject ambiguous requests.
      dropInvalidHeaderFields: true,
      desyncMitigationMode: elbv2.DesyncMitigationMode.STRICTEST,
    });
    this.loadBalancer.logAccessLogs(props.accessLogsBucket, 'alb');

    this.loadBalancer.addRedirect({ sourcePort: 80, targetPort: 443 });

    this.listener = this.loadBalancer.addListener('Https', {
      port: 443,
      certificates: [acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn)],
      sslPolicy: elbv2.SslPolicy.FIPS_TLS13_12_RES,
    });
  }

  /**
   * Wraps `next` in the OIDC authenticate action.
   *
   * @param onUnauthenticatedRequest `AUTHENTICATE` redirects browsers to the IdP (page loads).
   *   `DENY` returns 401 instead, which suits `fetch` calls: a redirect to the IdP would fail
   *   CORS and surface as an opaque network error rather than a status the SPA can act on.
   */
  authenticated(
    next: elbv2.ListenerAction,
    onUnauthenticatedRequest = elbv2.UnauthenticatedAction.AUTHENTICATE,
  ): elbv2.ListenerAction {
    return elbv2.ListenerAction.authenticateOidc({
      issuer: this.oidc.issuer,
      authorizationEndpoint: this.oidc.authorizationEndpoint,
      tokenEndpoint: this.oidc.tokenEndpoint,
      userInfoEndpoint: this.oidc.userInfoEndpoint,
      clientId: this.oidc.clientId,
      clientSecret: SecretValue.secretsManager(this.oidc.clientSecretArn),
      scope: 'openid email profile',
      sessionCookieName: SESSION_COOKIE_NAME,
      // The ALB default is 7 days; government systems typically require much shorter sessions.
      sessionTimeout: Duration.hours(8),
      onUnauthenticatedRequest,
      next,
    });
  }
}
