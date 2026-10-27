/** `apps/<app>/microfrontend.json` — describes one independently deployable frontend. */
export type AppDescriptor = ShellDescriptor | RemoteDescriptor;

interface BaseDescriptor {
  /** Module Federation container name, S3 prefix and AppConfig application suffix. */
  name: string;
  displayName: string;
  owner: string;
  devPort: number;
}

export interface ShellDescriptor extends BaseDescriptor {
  kind: 'shell';
}

export interface RemoteDescriptor extends BaseDescriptor {
  kind: 'remote';
  /** Base path the shell mounts this module at, e.g. `/dashboard`. */
  route: string;
  /** Module Federation expose key whose default export is the module's root component. */
  exposedModule: string;
}

const APP_NAME = /^[a-z][a-z0-9]*$/;

/** Validates an untrusted descriptor (e.g. parsed from disk) and narrows its type. */
export function parseAppDescriptor(value: unknown, source = 'microfrontend.json'): AppDescriptor {
  const fail = (reason: string): never => {
    throw new Error(`Invalid ${source}: ${reason}`);
  };
  if (typeof value !== 'object' || value === null) fail('expected an object');
  const d = value as Record<string, unknown>;

  if (typeof d.name !== 'string' || !APP_NAME.test(d.name)) fail(`name must match ${APP_NAME}`);
  if (typeof d.displayName !== 'string' || d.displayName === '') fail('displayName is required');
  if (typeof d.owner !== 'string' || d.owner === '') fail('owner is required');
  if (typeof d.devPort !== 'number') fail('devPort must be a number');

  if (d.kind === 'shell') return d as unknown as ShellDescriptor;
  if (d.kind !== 'remote') fail('kind must be "shell" or "remote"');
  if (typeof d.route !== 'string' || !d.route.startsWith('/')) fail('route must start with "/"');
  if (typeof d.exposedModule !== 'string' || !d.exposedModule.startsWith('./')) {
    fail('exposedModule must start with "./"');
  }
  return d as unknown as RemoteDescriptor;
}
