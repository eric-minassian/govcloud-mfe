import '@govcloud-mfe/ui/styles.css';
import './shell.css';
import {
  createPlatformQueryClient,
  MicroFrontendProvider,
  PlatformProvider,
} from '@govcloud-mfe/platform-sdk';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';

const queryClient = createPlatformQueryClient();
const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <PlatformProvider queryClient={queryClient}>
      <MicroFrontendProvider name="shell" version={__RELEASE_VERSION__}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MicroFrontendProvider>
      {import.meta.env.DEV && <ReactQueryDevtools />}
    </PlatformProvider>
  </StrictMode>,
);
