import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getPublicCase } from '../api/cases.js';
import { difficultyLabel } from '../lib/format.js';

/** Public, read-only result (FR-28, API-21). Shows no evidence. */
export default function SharePage() {
  const { shareToken = '' } = useParams();
  const query = useQuery({
    queryKey: ['public-case', shareToken],
    queryFn: () => getPublicCase(shareToken),
    retry: false,
  });
  const data = query.data;

  if (query.isLoading)
    return (
      <main className="auth-shell" aria-busy="true">
        <p className="loading-line">Opening the shared file…</p>
      </main>
    );
  if (!data)
    return (
      <main className="auth-shell">
        <section className="auth-card" role="alert">
          <h1>This link no longer works.</h1>
          <p className="auth-copy">The detective may have stopped sharing this case.</p>
          <Link className="form-submit inline-submit" to="/">
            Open your own case
          </Link>
        </section>
      </main>
    );

  const { outcome } = data;
  const verdict = outcome.gaveUp ? 'Closed without an answer' : outcome.correct ? 'Solved' : 'Unsolved';
  return (
    <main className="shared">
      <Link className="wordmark" to="/" aria-label="AI Mystery Room home">
        <span className="wordmark-icon">M</span>
        <span className="wordmark-text">Mystery Room</span>
      </Link>
      <article className="shared__card">
        <p className="briefing__place">
          {data.setting.location}
          <span>{difficultyLabel[data.difficulty]} case</span>
        </p>
        <h1>{data.title}</h1>
        <p className="shared__verdict">
          <span
            className={`verdict__stamp verdict__stamp--${outcome.correct && !outcome.gaveUp ? 'solved' : 'unsolved'}`}
          >
            {verdict}
          </span>
          <span>
            {outcome.score} points · {outcome.attemptsUsed} {outcome.attemptsUsed === 1 ? 'accusation' : 'accusations'}{' '}
            · {outcome.hintsUsed} {outcome.hintsUsed === 1 ? 'hint' : 'hints'}
          </span>
        </p>
        <p className="briefing__text">{data.briefing}</p>
        <h2>Who did it</h2>
        <p>
          <strong>{data.culprit.name}</strong>, {data.culprit.role}.
        </p>
        <p className="shared__explanation">{data.explanation}</p>
        <Link to="/" className="primary-button">
          Write your own mystery
        </Link>
      </article>
    </main>
  );
}
