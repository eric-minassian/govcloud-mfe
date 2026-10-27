import { createContext, type ReactNode, useContext } from 'react';

interface MicroFrontendContextValue {
  /** Name of the module rendering this subtree, e.g. `dashboard`. */
  name: string;
  /** Version of the module rendering this subtree. */
  version: string;
}

const MicroFrontendContext = createContext<MicroFrontendContextValue | null>(null);

/**
 * Tells platform hooks which module they're running in, so `useFeatureFlag('x')` reads the
 * calling module's own flags and telemetry is attributed to the right app. The shell wraps every
 * remote in one of these; it also wraps itself.
 */
export function MicroFrontendProvider({
  name,
  version,
  children,
}: MicroFrontendContextValue & { children: ReactNode }) {
  return (
    <MicroFrontendContext.Provider value={{ name, version }}>
      {children}
    </MicroFrontendContext.Provider>
  );
}

export function useMicroFrontend(): MicroFrontendContextValue {
  const context = useContext(MicroFrontendContext);
  if (!context) {
    throw new Error('useMicroFrontend must be used inside <MicroFrontendProvider>');
  }
  return context;
}
