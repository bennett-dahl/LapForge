import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

const cssLink = document.createElement('link');
cssLink.rel = 'stylesheet';
cssLink.href = '/static/style.css';
document.head.appendChild(cssLink);

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/x-icon';
favicon.href = '/static/favicon.ico';
document.head.appendChild(favicon);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.DEV ? '/static/spa' : ''}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
