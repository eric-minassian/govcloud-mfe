/** Object keys in the per-stage artifact bucket. See docs/contracts.md §2. */
export const bucketLayout = {
  /** Immutable prefix holding one build of one app. */
  versionPrefix: (app: string, version: string) => `apps/${app}/${version}/`,
  /** Written last by `release publish`; a version without it is not deployable. */
  uploadMarker: (app: string, version: string) => `apps/${app}/${version}/.upload-complete`,
  /** Mutable pointer to the active release of an app. */
  releaseRecord: (app: string) => `releases/${app}.json`,
  /** Shell entry document served by nginx for every navigation request. */
  shellEntryDocument: 'index.html',
} as const;

/** URL path (and S3 key) prefix every build is compiled against. */
export const publicPathFor = (app: string, version: string) => `/apps/${app}/${version}/`;

/** `releases/<app>.json` — which version of an app is live in a stage. */
export interface ReleaseRecord {
  schemaVersion: 1;
  app: string;
  kind: 'shell' | 'remote';
  version: string;
  /** Shell: path of its index.html. Remote: path of its `mf-manifest.json`. */
  entry: string;
  displayName: string;
  route?: string;
  exposedModule?: string;
  commit: string;
  releasedAt: string;
  releasedBy: string;
}
