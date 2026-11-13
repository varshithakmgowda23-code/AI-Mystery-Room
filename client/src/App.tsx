import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Difficulty, Tone } from '@ai-mystery-room/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api';
type User = { id: string; email: string | null; displayName: string; isGuest: boolean };

const generationErrorMessages: Record<string, string> = {
  CONTENT_POLICY:
    'Please choose a fictional, non-graphic mystery seed without real people, ongoing crimes, or instructions for real-world harm.',
  AI_QUOTA_EXCEEDED:
    'Daily AI generation limit reached. Our AI detective needs a break! Please try again after your quota resets.',
  AI_RATE_LIMITED: 'The AI service is receiving too many requests. Please wait a bit and try again.',
  AI_UNAVAILABLE: 'The AI model is temporarily unavailable. Please try again later.',
  AI_NETWORK_ERROR: 'Unable to connect to the AI service. Please try again when your connection is available.',
  GENERATION_FAILED: 'Something went wrong while generating the case.',
};
const genericGenerationError = generationErrorMessages.GENERATION_FAILED;

function safeGenerationErrorMessage(message?: string): string {
  if (!message) return genericGenerationError;
  if (message.startsWith('Please choose a fictional, non-graphic mystery seed'))
    return generationErrorMessages.CONTENT_POLICY;
  const knownMessage = Object.values(generationErrorMessages).find(
    (safeMessage) => message === safeMessage || message.startsWith(`${safeMessage} Approximate retry time:`),
  );
  return knownMessage ? message : genericGenerationError;
}

async function postAuth(action: string, payload: Record<string, string> = {}): Promise<User> {
  const response = await fetch(`${API_BASE}/auth/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as { user?: User; error?: { message?: string } };
  if (!response.ok || !result.user) throw new Error(result.error?.message ?? 'Unable to complete sign in.');
  return result.user;
}

async function getCurrentUser(): Promise<User | null> {
  const response = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Could not check your session.');
  const result = (await response.json()) as { user: User };
  return result.user;
}

async function createCase(payload: { seed: string; difficulty: Difficulty; tone: Tone }): Promise<string> {
  const send = async () =>
    fetch(`${API_BASE}/cases`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  let response = await send();
  if (response.status === 401) {
    await postAuth('guest');
    response = await send();
  }
  const result = (await response.json()) as { caseId?: string; error?: { message?: string } };
  if (!response.ok || !result.caseId) throw new Error(result.error?.message ?? 'Could not open the case.');
  return result.caseId;
}

type CaseProgress = {
  status: 'queued' | 'generating' | 'ready' | 'failed';
  progress: { stage: string; percent: number; label: string };
  error?: string;
  errorCode?: string;
};

export function formatRetryTime(value?: string): string | null {
  const retryAt = value ? new Date(value) : null;
  if (!retryAt || Number.isNaN(retryAt.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(retryAt);
}

export async function getCaseStatus(caseId: string): Promise<CaseProgress> {
  const response = await fetch(`${API_BASE}/cases/${caseId}/status`, { credentials: 'include' });
  const result = (await response.json()) as Omit<CaseProgress, 'error' | 'errorCode'> & {
    error?: string | { code?: string; message?: string; retryAt?: string };
  };
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? 'That case could not be found.'
        : 'Something went wrong while checking case generation.',
    );
  if (!result.error) return { status: result.status, progress: result.progress };
  const errorCode = typeof result.error === 'object' ? result.error.code : undefined;
  const safeMessage = errorCode
    ? (generationErrorMessages[errorCode] ?? genericGenerationError)
    : typeof result.error === 'string' && result.error.startsWith('Please choose a fictional, non-graphic mystery seed')
      ? generationErrorMessages.CONTENT_POLICY
      : genericGenerationError;
  const retryValue = typeof result.error === 'object' ? result.error.retryAt : undefined;
  const retryTime = formatRetryTime(retryValue);
  return { ...result, errorCode, error: `${safeMessage}${retryTime ? ` Approximate retry time: ${retryTime}.` : ''}` };
}

function HomePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [seed, setSeed] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [tone, setTone] = useState<Tone>('classic_noir');
  const create = useMutation({
    mutationFn: createCase,
    onSuccess: async (caseId) => {
      await queryClient.invalidateQueries({ queryKey: ['current-user'] });
      navigate(`/cases/${caseId}/generating`);
    },
  });
  const guest = useMutation({
    mutationFn: () => postAuth('guest'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['current-user'] });
      navigate('/cases');
    },
  });
  return (
    <main className="home-shell min-h-screen">
      <header className="topbar">
        <Link className="wordmark" to="/" aria-label="AI Mystery Room home">
          <span className="wordmark-icon">M</span> MYSTERY ROOM
        </Link>
        <div className="topbar-actions">
          <span className="edition">AN INTERACTIVE INVESTIGATION</span>
          <Link className="text-link" to="/login">
            SIGN IN
          </Link>
        </div>
      </header>
      <section className="hero">
        <div className="eyebrow">
          <span className="status-dot" /> YOUR NEXT CASE IS WAITING
        </div>
        <h1>
          Every story
          <br />
          hides a <em>truth.</em>
        </h1>
        <p className="intro">
          Build a mystery from a single idea. Examine the evidence, question every detail, and decide who did it.
        </p>
        <form
          className="seed-card"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ seed: seed.trim(), difficulty, tone });
          }}
        >
          <label htmlFor="seed">SET THE SCENE</label>
          <textarea
            id="seed"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            maxLength={500}
            minLength={10}
            required
            placeholder="A priceless painting vanished during the gallery's opening night…"
          />
          <div className="case-options">
            <label>
              DIFFICULTY
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
            <label>
              TONE
              <select value={tone} onChange={(event) => setTone(event.target.value as Tone)}>
                <option value="classic_noir">Classic Noir</option>
                <option value="modern_thriller">Modern Thriller</option>
                <option value="cozy">Cozy</option>
                <option value="corporate">Corporate</option>
              </select>
            </label>
          </div>
          <div className="seed-footer">
            <span>{seed.trim().length}/500 · minimum 10</span>
            <button type="submit" className="open-case" disabled={seed.trim().length < 10 || create.isPending}>
              {create.isPending ? 'OPENING…' : 'OPEN THE CASE'} <span aria-hidden="true">↗</span>
            </button>
          </div>
          {create.error && (
            <p className="form-error" role="alert">
              {create.error.message}
            </p>
          )}
        </form>
        <div className="home-actions">
          <button className="guest-button" type="button" onClick={() => guest.mutate()} disabled={guest.isPending}>
            PLAY AS GUEST <span aria-hidden="true">↗</span>
          </button>
          <Link className="text-link" to="/register">
            CREATE AN ACCOUNT
          </Link>
        </div>
        {guest.error && (
          <p className="form-error" role="alert">
            {guest.error.message}
          </p>
        )}
      </section>
      <footer className="home-footer">
        <span>FICTIONAL CASES. REAL DEDUCTION.</span>
        <span>THE MYSTERY ROOM</span>
      </footer>
    </main>
  );
}

function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (payload: Record<string, string>) => postAuth(mode, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['current-user'] });
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

function ProtectedCases() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const userQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const logout = useMutation({
    mutationFn: async () => {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    },
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
        <button type="button" className="back-link button-link" onClick={() => logout.mutate()}>
          Sign out
        </button>
      </section>
    </main>
  );
}

function RequireSession({ children }: { children: ReactNode }) {
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

function GeneratingPage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const status = useQuery({
    queryKey: ['case-status', caseId],
    queryFn: () => getCaseStatus(caseId),
    enabled: Boolean(caseId),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === 'ready' || query.state.data?.status === 'failed' ? false : 2000,
  });
  useEffect(() => {
    if (status.data?.status === 'failed' && !status.data.errorCode && status.data.error === genericGenerationError) {
      void status.refetch();
    }
  }, [status.data?.status, status.data?.errorCode, status.data?.error, status.refetch]);
  useEffect(() => {
    if (status.data?.status === 'ready') navigate(`/cases/${caseId}`, { replace: true });
  }, [caseId, navigate, status.data?.status]);
  const percent = status.data?.progress.percent ?? 0;
  return (
    <main className="auth-shell">
      <section className="auth-card generating-card">
        <p className="eyebrow">CASE FILE · GENERATING</p>
        <h1>{status.data?.status === 'failed' ? 'The trail went cold.' : 'Putting the pieces together.'}</h1>
        <p className="auth-copy">
          {status.data?.status === 'failed'
            ? safeGenerationErrorMessage(status.data.error)
            : (status.data?.progress.label ?? 'Preparing the investigation…')}
        </p>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Case generation progress"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="progress-caption">
          <span>{percent}%</span>
          <span>{status.data?.status?.toUpperCase() ?? 'QUEUED'}</span>
        </div>
        {status.data?.status === 'failed' && (
          <Link className="form-submit inline-submit" to="/">
            TRY ANOTHER CASE <span aria-hidden="true">↗</span>
          </Link>
        )}
        {status.error && (
          <p className="form-error" role="alert">
            {safeGenerationErrorMessage(status.error.message)}
          </p>
        )}
      </section>
    </main>
  );
}

function CaseBoardPlaceholder() {
  const { caseId = '' } = useParams();
  const status = useQuery({ queryKey: ['case-status', caseId], queryFn: () => getCaseStatus(caseId), retry: false });
  if (status.isLoading)
    return (
      <main className="auth-shell">
        <p className="eyebrow">OPENING CASE FILE…</p>
      </main>
    );
  if (status.data?.status !== 'ready') return <Navigate to={`/cases/${caseId}/generating`} replace />;
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">CASE FILE READY</p>
        <h1>The evidence is in.</h1>
        <p className="auth-copy">
          The investigation is ready. The full case board and evidence viewers arrive in the next milestone.
        </p>
        <Link className="form-submit inline-submit" to="/">
          OPEN ANOTHER CASE <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="not-found min-h-screen">
      <p className="eyebrow">404 · DEAD END</p>
      <h1>This room has no case file.</h1>
      <Link to="/">
        Return to the entrance <span aria-hidden="true">↗</span>
      </Link>
    </main>
  );
}

function ExistingSessionRedirect({ children }: { children: ReactNode }) {
  const location = useLocation();
  const userQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  if (userQuery.data) return <Navigate to="/cases" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        path="/login"
        element={
          <ExistingSessionRedirect>
            <AuthPage mode="login" />
          </ExistingSessionRedirect>
        }
      />
      <Route
        path="/register"
        element={
          <ExistingSessionRedirect>
            <AuthPage mode="register" />
          </ExistingSessionRedirect>
        }
      />
      <Route path="/cases" element={<ProtectedCases />} />
      <Route
        path="/cases/:caseId/generating"
        element={
          <RequireSession>
            <GeneratingPage />
          </RequireSession>
        }
      />
      <Route
        path="/cases/:caseId"
        element={
          <RequireSession>
            <CaseBoardPlaceholder />
          </RequireSession>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
