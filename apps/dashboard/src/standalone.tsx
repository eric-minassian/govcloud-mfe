import '@govcloud-mfe/ui/styles.css';
import {
  createPlatformQueryClient,
  MicroFrontendProvider,
  PlatformProvider,
} from '@govcloud-mfe/platform-sdk';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import descriptor from '../microfrontend.json';
import App from './App';

/**
 * Standalone dev harness: provides what the shell normally provides (query client, module
 * context, router) so the team can develop this module without running the shell.
 */
const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <PlatformProvider queryClient={createPlatformQueryClient()}>
      <MicroFrontendProvider name={descriptor.name} version="local">
        <BrowserRouter>
          <main style={{ maxWidth: '72rem', margin: '0 auto', padding: '2rem 1.5rem' }}>
            <Routes>
              <Route path="/*" element={<App basePath="/" />} />
            </Routes>
          </main>
        </BrowserRouter>
      </MicroFrontendProvider>
    </PlatformProvider>
  </StrictMode>,
);
