import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { getCurrentUser, logout } from '../api/auth.js';

export default function CasesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const userQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.setQueryData(['current-user'], null);
      navigate('/');
    },
  });
  if (userQuery.isLoading)
    return (
      <main className="auth-shell">
        <p className="eyebrow">CHECKING YOUR CASE FILE…</p>
      </main>
    );
  if (!userQuery.data) return <Navigate to="/login" replace />;
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">SIGNED IN AS {userQuery.data.isGuest ? 'GUEST' : 'DETECTIVE'}</p>
        <h1>Welcome, {userQuery.data.displayName}.</h1>
        <p className="auth-copy">Your case archive will appear here. Start a new investigation from the entrance.</p>
        <Link className="form-submit inline-submit" to="/">
          BACK TO THE ENTRANCE <span aria-hidden="true">↗</span>
        </Link>
        <button type="button" className="back-link button-link" onClick={() => signOut.mutate()}>
          Sign out
        </button>
      </section>
    </main>
  );
}
