/**
 * Every module shares one query cache, so query keys must be namespaced by owner to avoid two
 * teams' modules colliding on, say, `['items']`.
 *
 * - Platform data (user, flags, preferences) lives under `['platform', ...]`.
 * - A module's own data lives under `[<module name>, ...]` — build keys with this helper.
 *
 * @example moduleQueryKey('dashboard', 'service-health') // ['dashboard', 'service-health']
 */
export function moduleQueryKey<const T extends readonly unknown[]>(
  moduleName: string,
  ...parts: T
): readonly [string, ...T] {
  return [moduleName, ...parts] as const;
}
