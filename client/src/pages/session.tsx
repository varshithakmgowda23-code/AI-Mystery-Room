import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { getCurrentUser } from '../api/auth.js';

export const useCurrentUser = () => useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });

export function RequireSession({ children }: { children: ReactNode }) {
  const userQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  if (userQuery.isLoading)
    return (
      <main className="auth-shell">
        <p className="eyebrow">CHECKING YOUR CASE FILE…</p>
      </main>
    );
  if (!userQuery.data) return <Navigate to="/login" replace />;
  return children;
}

export function ExistingSessionRedirect({ children }: { children: ReactNode }) {
  const location = useLocation();
  const userQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  if (userQuery.data) return <Navigate to="/cases" state={{ from: location }} replace />;
  return children;
}
