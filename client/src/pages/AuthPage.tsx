import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { postAuth, type User } from '../api/auth.js';
import { SiteHeader } from '../components/layout/SiteHeader.js';

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

  const login = mode === 'login';
  return (
    <div className="auth-page">
      <SiteHeader />
      <main className="auth-main">
        <section className="auth-panel" aria-labelledby="auth-title">
          <h1 id="auth-title">{login ? 'Welcome back, detective.' : 'Open your own case files.'}</h1>
          <p className="auth-copy">
            {login
              ? 'Sign in to return to your cases.'
              : 'An account keeps your cases and scores. Guest cases are deleted after 7 days.'}
          </p>
          <form onSubmit={submit} className="auth-form">
            {!login && (
              <label>
                Display name
                <input name="displayName" autoComplete="nickname" required maxLength={60} />
              </label>
            )}
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required maxLength={254} />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={login ? 'current-password' : 'new-password'}
                required
                minLength={login ? 1 : 8}
                maxLength={128}
              />
              {!login && <span className="field-hint">At least 8 characters.</span>}
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button auth-form__submit" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Please wait…' : login ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <p className="auth-switch">
            {login ? 'New here?' : 'Already have an account?'}{' '}
            <Link to={login ? '/register' : '/login'}>{login ? 'Create an account' : 'Sign in'}</Link>
          </p>
        </section>
      </main>
    </div>
  );
}
