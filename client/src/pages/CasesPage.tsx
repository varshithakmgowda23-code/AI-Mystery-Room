import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { CaseListItem } from '@ai-mystery-room/shared';
import { getCurrentUser, logout, postAuth, type User } from '../api/auth.js';
import { deleteCase, listCases } from '../api/cases.js';
import { difficultyLabel, toneLabel } from '../lib/format.js';

function statusText(item: CaseListItem): string {
  switch (item.status) {
    case 'queued':
    case 'generating':
      return 'Being written';
    case 'failed':
      return 'Generation failed';
    case 'ready':
      return 'Not opened yet';
    case 'in_progress':
      return item.evidenceTotal ? `${item.evidenceViewed ?? 0} of ${item.evidenceTotal} examined` : 'In progress';
    case 'resolved':
      return item.gaveUp ? 'Closed without an answer' : item.correct ? 'Solved' : 'Unsolved';
  }
}

function hrefFor(item: CaseListItem): string {
  if (item.status === 'resolved') return `/cases/${item.id}/verdict`;
  if (item.status === 'ready' || item.status === 'in_progress') return `/cases/${item.id}`;
  return `/cases/${item.id}/generating`;
}

function actionLabel(item: CaseListItem): string {
  if (item.status === 'resolved') return 'Read the solution';
  if (item.status === 'ready') return 'Open the case';
  if (item.status === 'in_progress') return 'Continue';
  if (item.status === 'failed') return 'Retry';
  return 'Watch progress';
}

/** FR-03: a guest keeps their cases by adding an email and password. */
function UpgradeForm({ onDone }: { onDone: (user: User) => void }) {
  const [error, setError] = useState('');
  const upgrade = useMutation({
    mutationFn: (payload: Record<string, string>) => postAuth('upgrade', payload),
    onSuccess: onDone,
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
    const displayName = String(data.get('displayName') ?? '').trim();
    if (displayName) payload.displayName = displayName;
    upgrade.mutate(payload);
  }
  return (
    <form className="upgrade" onSubmit={submit} aria-labelledby="upgrade-title">
      <h2 id="upgrade-title">Keep your cases</h2>
      <p className="muted">Guest case files are deleted after 7 days. Add an email and password to keep them.</p>
      <div className="upgrade__fields">
        <label>
          Name
          <input name="displayName" autoComplete="name" maxLength={60} placeholder="Optional" />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required maxLength={254} />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary-button" disabled={upgrade.isPending}>
        {upgrade.isPending ? 'Saving…' : 'Create my account'}
      </button>
    </form>
  );
}

export default function CasesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const userQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const cases = useQuery({
    queryKey: ['cases', page],
    queryFn: () => listCases(page),
    enabled: Boolean(userQuery.data),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === 'queued' || item.status === 'generating') ? 4000 : false,
  });
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(['current-user'], null);
      queryClient.removeQueries({ queryKey: ['cases'] });
      navigate('/');
    },
  });
  const remove = useMutation({
    mutationFn: deleteCase,
    onSuccess: () => {
      setConfirmDelete(undefined);
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });

  if (userQuery.isLoading)
    return (
      <main className="auth-shell" aria-busy="true">
        <p className="loading-line">Checking your case file…</p>
      </main>
    );
  const user = userQuery.data;
  if (!user) return <Navigate to="/login" replace />;
  const list = cases.data;

  return (
    <div className="archive">
      <header className="board-top">
        <Link className="wordmark" to="/" aria-label="AI Mystery Room home">
          <span className="wordmark-icon">M</span>
          <span className="wordmark-text">Mystery Room</span>
        </Link>
        <p className="board-top__case">
          <span>
            {user.isGuest ? 'Signed in as guest' : 'Signed in as'} {user.displayName}
          </span>
        </p>
        <button type="button" className="text-button" onClick={() => signOut.mutate()}>
          Sign out
        </button>
      </header>

      <main className="archive__main">
        <div className="archive__head">
          <h1>Your cases</h1>
          <Link to="/" className="primary-button">
            Open a new case
          </Link>
        </div>

        {user.isGuest && <UpgradeForm onDone={(next) => queryClient.setQueryData(['current-user'], next)} />}

        {cases.isLoading && <p className="loading-line">Pulling your files…</p>}
        {cases.error && (
          <p className="form-error" role="alert">
            {cases.error.message}{' '}
            <button type="button" className="text-button" onClick={() => void cases.refetch()}>
              Try again
            </button>
          </p>
        )}
        {list && list.items.length === 0 && (
          <div className="archive__empty">
            <p className="viewer-empty__title">No cases yet.</p>
            <p>Describe a crime in a sentence and the room will build the whole investigation around it.</p>
            <Link to="/" className="primary-button">
              Write your first case
            </Link>
          </div>
        )}
        {list && list.items.length > 0 && (
          <ol className="case-rows">
            {list.items.map((item) => (
              <li key={item.id} className={`case-row case-row--${item.status}`}>
                <div className="case-row__main">
                  <Link to={hrefFor(item)} className="case-row__title">
                    {item.title}
                  </Link>
                  <p className="case-row__meta">
                    {difficultyLabel[item.difficulty]}, {toneLabel[item.tone].toLowerCase()} ·{' '}
                    {new Date(item.createdAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <p className="case-row__status">{statusText(item)}</p>
                <p className="case-row__score">{item.status === 'resolved' ? `${item.score ?? 0} pts` : ''}</p>
                <div className="case-row__actions">
                  {confirmDelete === item.id ? (
                    <>
                      <span className="muted">Delete permanently?</span>
                      <button
                        type="button"
                        className="text-button case-row__danger"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(item.id)}
                      >
                        Delete
                      </button>
                      <button type="button" className="text-button" onClick={() => setConfirmDelete(undefined)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <Link to={hrefFor(item)} className="ghost-button case-row__open">
                        {actionLabel(item)}
                      </Link>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setConfirmDelete(item.id)}
                        aria-label={`Delete ${item.title}`}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {remove.error && (
          <p className="form-error" role="alert">
            {remove.error.message}
          </p>
        )}
        {list && list.totalPages > 1 && (
          <nav className="pager" aria-label="Pages">
            <button type="button" className="text-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Newer
            </button>
            <span className="muted">
              Page {list.page} of {list.totalPages}
            </span>
            <button
              type="button"
              className="text-button"
              disabled={page >= list.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Older
            </button>
          </nav>
        )}
      </main>
    </div>
  );
}
