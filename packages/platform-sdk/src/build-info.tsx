import type { ComposedModule } from '@govcloud-mfe/contracts';
import { createContext, useContext } from 'react';

/** What is inside the running build: its version and the revision of every module in it. */
export interface BuildInfo {
  version: string;
  modules: ComposedModule[];
}

export const BuildInfoContext = createContext<BuildInfo>({ version: 'unknown', modules: [] });

/** Version and module composition of the build the user is running. Provided by the app. */
export function useBuildInfo(): BuildInfo {
  return useContext(BuildInfoContext);
}
