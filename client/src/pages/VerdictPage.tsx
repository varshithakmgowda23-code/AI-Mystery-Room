import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { ClueRole, PlayerCaseView } from '@ai-mystery-room/shared';
import { getCase, setSharing } from '../api/cases.js';
import type { ApiError } from '../api/http.js';
import { Portrait } from '../components/suspects/SuspectCard.js';
import { evidenceTypeLabel, Icon } from '../components/layout/Icon.js';
import { difficultyLabel } from '../lib/format.js';

const roleLabel: Record<ClueRole, string> = {
  true_clue: 'Points to the culprit',
  red_herring: 'Red herring',
  alibi: 'Alibi',
  context: 'Background',
};

function headline(data: PlayerCaseView) {
  const result = data.result;
  if (!result) return { stamp: 'Closed', title: 'Case closed.' };
  if (result.gaveUp) return { stamp: 'Closed', title: 'You closed the file without an answer.' };
  if (result.correct) return { stamp: 'Solved', title: 'You found the culprit.' };
  return { stamp: 'Unsolved', title: 'The culprit got away.' };
}

function ShareControl({ caseId }: { caseId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const share = useMutation({
    mutationFn: (enabled: boolean) => setSharing(caseId, enabled),
    onSuccess: ({ shareToken }) => {
      setCopied(false);
      setLink(shareToken ? `${window.location.origin}/s/${shareToken}` : null);
    },
  });
  return (
    <div className="share">
      {link ? (
        <>
          <input
            className="share__link"
            readOnly
            value={link}
            aria-label="Public link to this result"
            onFocus={(e) => e.target.select()}
          />
          <button
            type="button"
            className="ghost-button"
            onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" className="text-button" onClick={() => share.mutate(false)}>
            Stop sharing
          </button>
        </>
      ) : (
        <button type="button" className="ghost-button" disabled={share.isPending} onClick={() => share.mutate(true)}>
          Create a public link to this result
        </button>
      )}
      {share.error && (
        <p className="form-error" role="alert">
          {share.error.message}
        </p>
      )}
    </div>
  );
}

export default function VerdictPage() {
  const { caseId = '' } = useParams();
  const query = useQuery({ queryKey: ['case', caseId], queryFn: () => getCase(caseId), retry: false });
  const data = query.data;

  if (query.isLoading)
    return (
      <main className="auth-shell" aria-busy="true">
        <p className="loading-line">Opening the solution…</p>
      </main>
    );
  if (query.error) {
    const error = query.error as ApiError;
    if (error.status === 401) return <Navigate to="/login" replace />;
    return (
      <main className="auth-shell">
        <section className="auth-card" role="alert">
          <h1>{error.status === 404 ? 'This case file does not exist.' : 'The solution would not open.'}</h1>
          <Link className="form-submit inline-submit" to="/cases">
            Go to my cases
          </Link>
        </section>
      </main>
    );
  }
  if (!data) return null;
  if (data.status !== 'resolved' || !data.solution) return <Navigate to={`/cases/${caseId}`} replace />;

  const { solution, result } = data;
  const culprit = data.suspects.find((suspect) => suspect.id === solution.culpritId);
  const nameOf = (id: string | null) => data.suspects.find((suspect) => suspect.id === id)?.name;
  const { stamp, title } = headline(data);
  const breakdown = result?.breakdown;
  const lastAccused = data.accusations.at(-1);

  return (
    <div className="verdict">
      <header className="board-top">
        <Link className="wordmark" to="/" aria-label="AI Mystery Room home">
          <span className="wordmark-icon">M</span>
          <span className="wordmark-text">Mystery Room</span>
        </Link>
        <p className="board-top__case">
          <span>{data.title}</span>
          <span className="pill">{difficultyLabel[data.difficulty]}</span>
        </p>
        <Link className="text-link" to="/cases">
          My cases
        </Link>
      </header>

      <main className="verdict__main">
        <section className="verdict__hero" aria-labelledby="verdict-title">
          <div className="verdict__culprit">
            {culprit && <Portrait caseId={caseId} suspect={culprit} size="lg" />}
            <span className={`verdict__stamp verdict__stamp--${stamp.toLowerCase()}`} aria-hidden="true">
              {stamp}
            </span>
          </div>
          <div>
            <h1 id="verdict-title">{title}</h1>
            <p className="verdict__who">
              <strong>{culprit?.name ?? 'Unknown'}</strong>, {culprit?.role}, did it.
              {!result?.correct && !result?.gaveUp && lastAccused && <> You accused {nameOf(lastAccused.suspectId)}.</>}
            </p>
            <p className="verdict__score">
              <span>{result?.score ?? 0}</span> points
            </p>
          </div>
        </section>

        <div className="verdict__grid">
          <article className="verdict__story">
            <section>
              <h2>Motive</h2>
              <p>{solution.motive}</p>
            </section>
            <section>
              <h2>Method</h2>
              <p>{solution.method}</p>
            </section>
            <section>
              <h2>What really happened</h2>
              <ol className="truth-timeline">
                {solution.timeline.map((entry, index) => (
                  <li key={index}>
                    <time>{entry.time}</time>
                    <span>{entry.event}</span>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h2>The full explanation</h2>
              <p>{solution.explanation}</p>
            </section>
          </article>

          <aside className="verdict__side">
            <section aria-labelledby="clues-title">
              <h2 id="clues-title">How the clues fit</h2>
              <ul className="clue-fit">
                {solution.clueBreakdown.map((clue) => {
                  const item = data.evidence.find((evidence) => evidence.id === clue.evidenceId);
                  return (
                    <li key={clue.evidenceId} className={`clue-fit__item clue-fit__item--${clue.role}`}>
                      <p className="clue-fit__head">
                        <span className="clue-fit__role">{roleLabel[clue.role]}</span>
                        {clue.pointsTo && clue.role !== 'context' && <span>about {nameOf(clue.pointsTo)}</span>}
                      </p>
                      <Link to={`/cases/${caseId}?e=${clue.evidenceId}`} className="clue-fit__title">
                        {item && <Icon name={item.type} size={14} label={evidenceTypeLabel[item.type]} />}{' '}
                        {item?.title ?? clue.evidenceId}
                      </Link>
                      {clue.explanation && <p className="clue-fit__why">{clue.explanation}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>

            {breakdown && (
              <section aria-labelledby="score-title">
                <h2 id="score-title">Score</h2>
                <dl className="score-table">
                  <div>
                    <dt>Base</dt>
                    <dd>{breakdown.base}</dd>
                  </div>
                  <div>
                    <dt>Hints used</dt>
                    <dd>−{breakdown.hintPenalty}</dd>
                  </div>
                  <div>
                    <dt>Wrong accusations</dt>
                    <dd>−{breakdown.wrongPenalty}</dd>
                  </div>
                  <div>
                    <dt>Time bonus ({breakdown.elapsedMinutes} min)</dt>
                    <dd>+{breakdown.timeBonus}</dd>
                  </div>
                  <div>
                    <dt>{difficultyLabel[data.difficulty]} multiplier</dt>
                    <dd>×{breakdown.multiplier}</dd>
                  </div>
                  <div className="score-table__total">
                    <dt>{result?.correct && !result.gaveUp ? 'Final score' : 'Final score (case not solved)'}</dt>
                    <dd>{breakdown.score}</dd>
                  </div>
                </dl>
              </section>
            )}

            <section aria-labelledby="next-title">
              <h2 id="next-title">What next</h2>
              <Link to="/" className="primary-button verdict__again">
                Open a new case
              </Link>
              <ShareControl caseId={caseId} />
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
