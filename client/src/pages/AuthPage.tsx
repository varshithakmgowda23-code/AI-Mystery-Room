import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { postAuth, type User } from '../api/auth.js';

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (payload: Record<string, string>) => postAuth(mode, payload),
    onSuccess: (user: User) => {
      queryClient.setQueryData(['current-user'], user);
      navigate('/cases');
    },
    onError: (reason: Error) => setError(reason.message),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const data = new FormData(event.currentTarget);
    const payload: Record<string, string> = {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
    };
    if (mode === 'register') payload.displayName = String(data.get('displayName') ?? '');
    mutation.mutate(payload);
  }

  return (
    <main className="auth-shell">
      <Link className="wordmark" to="/">
        <span className="wordmark-icon">M</span> MYSTERY ROOM
      </Link>
      <section className="auth-card">
        <p className="eyebrow">CASE FILE ACCESS</p>
        <h1>{mode === 'login' ? 'Welcome back.' : 'Join the investigation.'}</h1>
        <p className="auth-copy">
          {mode === 'login'
            ? 'Sign in to return to your case files.'
            : 'Create an account to keep your cases and solve at your own pace.'}
        </p>
        <form onSubmit={submit}>
          {mode === 'register' && (
            <label>
              DISPLAY NAME
              <input name="displayName" autoComplete="name" required maxLength={60} />
            </label>
          )}
          <label>
            EMAIL
            <input name="email" type="email" autoComplete="email" required maxLength={254} />
          </label>
          <label>
            PASSWORD
            <input
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'login' ? 1 : 8}
              maxLength={128}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="form-submit" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'PLEASE WAIT…' : mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}{' '}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        <p className="auth-switch">
          {mode === 'login' ? 'New to the room?' : 'Already have an account?'}{' '}
          <Link to={mode === 'login' ? '/register' : '/login'}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </Link>
        </p>
        <Link className="back-link" to="/">
          ← Back to the entrance
        </Link>
      </section>
    </main>
  );
}
