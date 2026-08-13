import { useEffect, type ReactElement } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SESSION_EXPIRED_EVENT, sessionEvents } from '../api/client.js';
import { Shell } from './Shell.js';
import { LoginScreen } from './LoginScreen.js';
import { DashboardHome } from './DashboardHome.js';

const queryClient = new QueryClient();

/**
 * Subscribes once to `sessionEvents` (design §10.8) and redirects to
 * `/login` on any unsuppressed 401 from `apiFetch` — the one place the spec's
 * "explicit expiry indication distinct from a generic error" is implemented,
 * regardless of which screen triggered it.
 */
function SessionExpiredRedirect(): null {
  const navigate = useNavigate();

  useEffect(() => {
    const handleSessionExpired = (): void => {
      void navigate('/login', { replace: true });
    };
    sessionEvents.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      sessionEvents.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [navigate]);

  return null;
}

export function App(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionExpiredRedirect />
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route
            path="/*"
            element={
              <Shell>
                <DashboardHome />
              </Shell>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
