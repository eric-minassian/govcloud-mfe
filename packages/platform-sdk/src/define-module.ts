import type { ModuleDescriptor, ModuleProps } from '@govcloud-mfe/contracts';
import type { ComponentType, LazyExoticComponent } from 'react';

/** What a module hands the app: who it is, where it mounts, and what to render there. */
export interface ModuleDefinition extends ModuleDescriptor {
  /**
   * The module's root component. Use `lazy(() => import('./App'))` so the module is split into
   * its own chunk and only downloaded when someone navigates to it.
   */
  component: ComponentType<ModuleProps> | LazyExoticComponent<ComponentType<ModuleProps>>;
}

/**
 * Declares a module. Each module's package entry default-exports the result, and the app's
 * composition list imports it. The type is the contract: if the platform changes it, every
 * module that no longer conforms fails to compile in the same pull request.
 */
export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition;
}
