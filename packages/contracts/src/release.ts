/** Object keys in the per-stage artifact bucket. See docs/contracts.md §3. */
export const bucketLayout = {
  /** Immutable prefix holding one composed build. */
  buildPrefix: (version: string) => `builds/${version}/`,
  /** Written last by `release deploy`; a build without it is not deployable. */
  uploadMarker: (version: string) => `builds/${version}/.upload-complete`,
  /** Mutable pointer to the live release. */
  releaseRecord: 'releases/web.json',
  /** Entry document nginx serves for every client-side route. */
  entryDocument: 'index.html',
} as const;

/** URL path (and S3 key) prefix the build is compiled against. */
export const publicPathFor = (version: string) => `/builds/${version}/`;

/** File name of the composition manifest inside every build (docs/contracts.md §5). */
export const COMPOSITION_FILE = 'composition.json';

/** One module as compiled into a particular build. */
export interface ComposedModule {
  name: string;
  owner: string;
  /** Content hash of the module's source. Equal revisions mean identical module code. */
  revision: string;
}

/** `builds/<version>/composition.json`, emitted by the web build. */
export interface Composition {
  modules: ComposedModule[];
}

/** `releases/web.json` — which build is live in a stage, and what it contains. */
export interface ReleaseRecord {
  schemaVersion: 1;
  version: string;
  commit: string;
  modules: ComposedModule[];
  releasedAt: string;
  releasedBy: string;
}

/** Modules whose code differs between two compositions, plus modules added or removed. */
export function changedModules(from: ComposedModule[], to: ComposedModule[]): ComposedModule[] {
  const before = new Map(from.map((m) => [m.name, m.revision]));
  const after = new Map(to.map((m) => [m.name, m.revision]));
  const changed = to.filter((m) => before.get(m.name) !== m.revision);
  const removed = from.filter((m) => !after.has(m.name));
  return [...changed, ...removed];
}
