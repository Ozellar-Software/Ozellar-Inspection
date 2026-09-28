import React from 'react';
import ReactDOM from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { msal } from './auth/msal';
import { App } from './app/App';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

async function boot() {
  await msal.initialize();
  const result = await msal.handleRedirectPromise();
  if (result?.account) msal.setActiveAccount(result.account);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MsalProvider instance={msal}>
        <QueryClientProvider client={queryClient}>
          <FluentProvider theme={webLightTheme}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </FluentProvider>
        </QueryClientProvider>
      </MsalProvider>
    </React.StrictMode>,
  );
}
void boot();
