import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import * as Sentry from '@sentry/react';
import { router } from './routes/router';
import './styles/tokens.css';
import './styles/workbench.css';
if (import.meta.env.VITE_SENTRY_DSN) Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN });
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15000, refetchOnWindowFocus: true, retry: 1 } },
});
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
