import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { naming } from '../naming';
import { CDK_CLI_VERSION } from './common';

const nodeRuntime = { 'runtime-versions': { nodejs: '24' } };
const cdkDeploy = `npx --yes aws-cdk@${CDK_CLI_VERSION} deploy --app cdk.out --exclusively --require-approval never`;

function spec(phases: Record<string, unknown>, artifacts?: Record<string, unknown>) {
  return codebuild.BuildSpec.fromObject({
    version: '0.2',
    env: { shell: 'bash' },
    phases,
    ...(artifacts ? { artifacts } : {}),
  });
}

/**
 * Delivery pipeline, Build stage. Compiles the web app and every module into one build, once, and
 * packages everything the deploy stages need into a self-contained release bundle. Later stages
 * run no build tools, so every stage deploys exactly what was tested.
 *
 *   release-bundle/
 *     assets/       apps/web/dist, compiled with publicPath /builds/<version>/, incl. composition.json
 *     cdk.out/      the WebStack for every stage (and nothing else)
 *     release.mjs   the release CLI, bundled into one file
 *     build.json    { version, commit }
 */
export function deliveryBuildSpec(): codebuild.BuildSpec {
  return spec(
    {
      install: {
        ...nodeRuntime,
        commands: ['corepack enable', 'pnpm install --frozen-lockfile'],
      },
      build: {
        commands: [
          // Rebuilding a commit targets the same S3 prefix, so publishing it again does nothing.
          // biome-ignore lint/suspicious/noTemplateCurlyInString: bash parameter expansion
          'export RELEASE_VERSION="${COMMIT_ID:0:12}"',
          // Biome, `turbo boundaries` (module isolation) and the CODEOWNERS ownership check.
          'pnpm lint',
          'pnpm turbo run typecheck test build --filter=@govcloud-mfe/web...',
          'pnpm --filter @govcloud-mfe/release-cli build',
          'mkdir -p release-bundle',
          'pnpm --filter @govcloud-mfe/infra exec cdk synth --quiet -c target=web --output "$CODEBUILD_SRC_DIR/release-bundle/cdk.out"',
          'cp -r apps/web/dist release-bundle/assets',
          'cp tools/release/dist/release.mjs release-bundle/',
          `jq -n --arg version "$RELEASE_VERSION" --arg commit "$COMMIT_ID" '{$version, $commit}' > release-bundle/build.json`,
        ],
      },
    },
    { 'base-directory': 'release-bundle', files: ['**/*'] },
  );
}

/**
 * Delivery pipeline, Deploy-<stage>. `STAGE`, `STAGE_REGION` and `RELEASE_ROLE_ARN` come from the
 * pipeline action. When CodePipeline rolls the stage back, it re-runs this with the previous
 * execution's bundle: the previous WebStack, and the previous build (still in S3) made live again.
 */
export function deliveryDeploySpec(): codebuild.BuildSpec {
  return spec({
    install: nodeRuntime,
    build: {
      commands: [
        'VERSION=$(jq -r .version build.json) && COMMIT=$(jq -r .commit build.json)',
        // 1. Web-level runtime resources: web app flags, web alarm, release role. Runs through the
        //    CDK bootstrap roles of the stage account (`cdk bootstrap --trust <tooling account>`).
        // biome-ignore lint/suspicious/noTemplateCurlyInString: ${STAGE} is expanded by bash
        `${cdkDeploy} "${naming.webStack('${STAGE}')}"`,
        // 2. Upload the build (skipped if already there) and point the stage at it.
        [
          'node release.mjs deploy --stage "$STAGE"',
          '--version "$VERSION" --commit "$COMMIT" --assets assets',
          '--role-arn "$RELEASE_ROLE_ARN" --region "$STAGE_REGION"',
        ].join(' '),
      ],
    },
  });
}

/**
 * Delivery pipeline, production bake. A release contains every team's module, so it watches every
 * app's client-error alarm (`ALARMS`: JSON list of `{ alarm, app, owner }`) for `BAKE_MINUTES`. If
 * any fires, it names the module and team, then fails so the stage's onFailure condition rolls the
 * whole release back. Alarms that don't exist yet (a brand-new module) are simply not reported.
 *
 * Why not CodePipeline's CloudWatchAlarm rule? Rules run under the pipeline role, in the pipeline's
 * account and region. The prod alarms are in another account and, because CodeConnections requires
 * the tooling account to be in us-gov-east-1, often in another region. The release role can read
 * them, so this step assumes it.
 */
export function bakeSpec(): codebuild.BuildSpec {
  return spec({
    build: {
      commands: [
        'CREDS=$(aws sts assume-role --role-arn "$RELEASE_ROLE_ARN" --role-session-name bake --query Credentials --output json)',
        'export AWS_ACCESS_KEY_ID=$(jq -r .AccessKeyId <<<"$CREDS") AWS_SECRET_ACCESS_KEY=$(jq -r .SecretAccessKey <<<"$CREDS") AWS_SESSION_TOKEN=$(jq -r .SessionToken <<<"$CREDS")',
        `names=$(jq -r '.[].alarm' <<<"$ALARMS" | tr '\\n' ' ')
deadline=$(( $(date +%s) + BAKE_MINUTES * 60 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  firing=$(aws cloudwatch describe-alarms --region "$STAGE_REGION" --alarm-names $names --state-value ALARM --query 'MetricAlarms[].AlarmName' --output text)
  if [ -n "$firing" ] && [ "$firing" != "None" ]; then
    for alarm in $firing; do
      jq -r --arg alarm "$alarm" '.[] | select(.alarm == $alarm) | "Client errors in \\(.app) (owner: \\(.owner)) after this release: \\(.alarm)"' <<<"$ALARMS"
    done
    echo "Failing so CodePipeline rolls the release back."
    exit 1
  fi
  echo "$(date -u +%H:%M:%S) all $(jq length <<<"$ALARMS") alarms OK"
  sleep 30
done`,
      ],
    },
  });
}

/** PR checks: run the given commands against the pull request's source branch. */
export function checksSpec(commands: string[]): codebuild.BuildSpec {
  return spec({
    install: {
      ...nodeRuntime,
      commands: ['corepack enable', 'pnpm install --frozen-lockfile'],
    },
    build: { commands },
  });
}

/**
 * Module flags pipeline, Synth stage: the module's ModuleStacks only, so the bundle can't contain
 * (or deploy) anything else. Installs just the infra package and what it depends on.
 */
export function moduleSynthSpec(module: string): codebuild.BuildSpec {
  return spec(
    {
      install: {
        ...nodeRuntime,
        commands: [
          'corepack enable',
          'pnpm install --frozen-lockfile --filter @govcloud-mfe/infra...',
        ],
      },
      build: {
        commands: [
          `pnpm --filter @govcloud-mfe/infra exec cdk synth --quiet -c target=module:${module} --output "$CODEBUILD_SRC_DIR/module-bundle/cdk.out"`,
        ],
      },
    },
    { 'base-directory': 'module-bundle', files: ['**/*'] },
  );
}

/**
 * Module flags pipeline, Deploy-<stage>. Deploying the stack creates a new hosted configuration
 * version and an AppConfig deployment; AppConfig's own rollout strategy and alarm monitor then act
 * as the bake and the automatic rollback.
 */
export function moduleDeploySpec(module: string): codebuild.BuildSpec {
  return spec({
    install: nodeRuntime,
    build: {
      commands: [
        // biome-ignore lint/suspicious/noTemplateCurlyInString: ${STAGE} is expanded by bash
        `${cdkDeploy} "${naming.moduleStack('${STAGE}', module)}"`,
      ],
    },
  });
}
