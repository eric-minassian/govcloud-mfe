import { createRequire } from 'node:module';
import type { AppDescriptor } from '@govcloud-mfe/contracts';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { naming } from './naming';

/**
 * Deploy with the same CDK CLI version that synthesized the cloud assembly, so the CLI always
 * understands the assembly's schema.
 */
const CDK_CLI_VERSION: string = createRequire(import.meta.url)('aws-cdk/package.json').version;

/** Node.js 24 is available on the Ubuntu standard:7.0 CodeBuild image. */
export const BUILD_IMAGE = codebuild.LinuxBuildImage.STANDARD_7_0;
const install = {
  'runtime-versions': { nodejs: '24' },
};

/**
 * Build stage: test and build the app once, then package everything the deploy stages need into a
 * self-contained release bundle. Later stages run no build tools and install nothing beyond the CDK
 * CLI, so every stage deploys exactly what was tested.
 *
 *   release-bundle/
 *     assets/               apps/<app>/dist, compiled with publicPath /apps/<app>/<version>/
 *     cdk.out/              this app's AppStacks for every stage
 *     microfrontend.json    the app descriptor (route, display name, ...)
 *     release.mjs           the release CLI, bundled into one file
 *     build.json            { app, version, commit }
 */
export function buildSpec(app: AppDescriptor): codebuild.BuildSpec {
  return codebuild.BuildSpec.fromObject({
    version: '0.2',
    env: { shell: 'bash' },
    phases: {
      install: {
        ...install,
        commands: ['corepack enable', 'pnpm install --frozen-lockfile'],
      },
      build: {
        commands: [
          // The version is derived from the commit: rebuilding a commit targets the same S3 prefix,
          // so publishing it again does nothing.
          // biome-ignore lint/suspicious/noTemplateCurlyInString: bash parameter expansion
          'export RELEASE_VERSION="${COMMIT_ID:0:12}"',
          `pnpm turbo run typecheck test build --filter=@govcloud-mfe/${app.name}...`,
          'pnpm --filter @govcloud-mfe/release-cli build',
          'mkdir -p release-bundle',
          `pnpm --filter @govcloud-mfe/infra exec cdk synth --quiet -c app=${app.name} --output "$CODEBUILD_SRC_DIR/release-bundle/cdk.out"`,
          `cp -r apps/${app.name}/dist release-bundle/assets`,
          `cp apps/${app.name}/microfrontend.json tools/release/dist/release.mjs release-bundle/`,
          `jq -n --arg app ${app.name} --arg version "$RELEASE_VERSION" --arg commit "$COMMIT_ID" '{$app, $version, $commit}' > release-bundle/build.json`,
        ],
      },
    },
    artifacts: { 'base-directory': 'release-bundle', files: ['**/*'] },
  });
}

/**
 * Deploy stage, once per stage (`STAGE`, `STAGE_REGION` and `RELEASE_ROLE_ARN` come from the
 * pipeline action). When CodePipeline rolls a stage back, it re-runs this with the previous
 * execution's bundle. That re-applies the previous AppStack and re-promotes the previous version,
 * which is still in S3.
 */
export function deploySpec(app: AppDescriptor): codebuild.BuildSpec {
  return codebuild.BuildSpec.fromObject({
    version: '0.2',
    env: { shell: 'bash' },
    phases: {
      install,
      build: {
        commands: [
          'VERSION=$(jq -r .version build.json) && COMMIT=$(jq -r .commit build.json)',
          // 1. The app's own infrastructure: alarm, AppConfig flags, release role. Runs through the
          //    CDK bootstrap roles of the stage account (`cdk bootstrap --trust <tooling account>`).
          // biome-ignore lint/suspicious/noTemplateCurlyInString: ${STAGE} is expanded by bash
          `npx --yes aws-cdk@${CDK_CLI_VERSION} deploy --app cdk.out --exclusively --require-approval never "${naming.appStack('${STAGE}', app.name)}"`,
          // 2. Upload the build (skipped if this version is already there) and point the stage at it.
          [
            `node release.mjs deploy --app ${app.name} --stage "$STAGE"`,
            '--version "$VERSION" --commit "$COMMIT"',
            '--assets assets --descriptor microfrontend.json',
            '--role-arn "$RELEASE_ROLE_ARN" --region "$STAGE_REGION"',
          ].join(' '),
        ],
      },
    },
  });
}

/**
 * Bake step for production. It watches the app's client-error alarm (fed by real browsers) for
 * `BAKE_MINUTES`. It fails if the alarm fires, and the stage's onFailure condition then rolls the
 * release back.
 *
 * Why not CodePipeline's CloudWatchAlarm rule? Rules run under the pipeline role, in the pipeline's
 * account and region. The prod alarm is in another account and, because CodeConnections requires
 * the tooling account to be in us-gov-east-1, often in another region. The release role can read
 * that alarm, so this step assumes it.
 */
export function bakeSpec(): codebuild.BuildSpec {
  return codebuild.BuildSpec.fromObject({
    version: '0.2',
    env: { shell: 'bash' },
    phases: {
      build: {
        commands: [
          'CREDS=$(aws sts assume-role --role-arn "$RELEASE_ROLE_ARN" --role-session-name bake --query Credentials --output json)',
          'export AWS_ACCESS_KEY_ID=$(jq -r .AccessKeyId <<<"$CREDS") AWS_SECRET_ACCESS_KEY=$(jq -r .SecretAccessKey <<<"$CREDS") AWS_SESSION_TOKEN=$(jq -r .SessionToken <<<"$CREDS")',
          `deadline=$(( $(date +%s) + BAKE_MINUTES * 60 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  state=$(aws cloudwatch describe-alarms --region "$STAGE_REGION" --alarm-names "$ALARM_NAME" --query 'MetricAlarms[0].StateValue' --output text)
  echo "$(date -u +%H:%M:%S) $ALARM_NAME: $state"
  if [ "$state" = "ALARM" ]; then
    echo "Client errors spiked after the release. Failing so CodePipeline rolls the stage back."
    exit 1
  fi
  sleep 30
done`,
        ],
      },
    },
  });
}
