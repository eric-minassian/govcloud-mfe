import '@govcloud-mfe/ui/styles.css';
import './app.css';
import { createPlatformQueryClient, PlatformProvider } from '@govcloud-mfe/platform-sdk';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';

// No async boundary or shared-module negotiation: every module is compiled into this bundle, so
// there's exactly one copy of each dependency and the page can boot directly.
const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <PlatformProvider queryClient={createPlatformQueryClient()} buildInfo={__BUILD_INFO__}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      {import.meta.env.DEV && <ReactQueryDevtools />}
    </PlatformProvider>
  </StrictMode>,
);
