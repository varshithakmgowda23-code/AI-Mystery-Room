import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { Difficulty, Tone } from '@ai-mystery-room/shared';
import { getCurrentUser, postAuth, type User } from '../api/auth.js';
import { createCase, listCases, type NewCase } from '../api/cases.js';
import { SiteHeader } from '../components/layout/SiteHeader.js';
import { difficultyLabel, toneLabel } from '../lib/format.js';
import { useCurrentUser } from './session.js';

const EXAMPLES = [
  'The lighthouse keeper’s logbook vanishes during a storm-night fundraiser on a small island.',
  'A prize-winning pumpkin is sabotaged the night before the village harvest fair.',
  'Quarterly results leak to a rival minutes before a startup’s board meeting.',
  'A rare first edition goes missing from a private library during a rainy book club.',
];

const DIFFICULTIES: Array<{ value: Difficulty; note: string }> = [
  { value: 'easy', note: '4 suspects, 8 pieces of evidence' },
  { value: 'medium', note: '5 suspects, 11 pieces' },
  { value: 'hard', note: '6 suspects, 14 pieces, subtle clues' },
];
const TONES: Tone[] = ['classic_noir', 'modern_thriller', 'cozy', 'corporate'];

function RecentCases() {
  const user = useCurrentUser().data;
  const recent = useQuery({ queryKey: ['cases', 1], queryFn: () => listCases(1), enabled: Boolean(user) });
  const items = recent.data?.items.slice(0, 3) ?? [];
  if (!user || items.length === 0) return null;
  return (
    <section className="recent" aria-labelledby="recent-title">
      <div className="recent__head">
        <h2 id="recent-title">Your recent cases</h2>
        <Link to="/cases">All cases</Link>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={
                item.status === 'resolved'
                  ? `/cases/${item.id}/verdict`
                  : item.status === 'ready' || item.status === 'in_progress'
                    ? `/cases/${item.id}`
                    : `/cases/${item.id}/generating`
              }
            >
              <span className="recent__title">{item.title}</span>
              <span className="recent__meta">
                {difficultyLabel[item.difficulty]}
                {item.status === 'resolved'
                  ? `, ${item.score ?? 0} points`
                  : item.status === 'in_progress'
                    ? ', in progress'
                    : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function HomePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [seed, setSeed] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [tone, setTone] = useState<Tone>('classic_noir');
  const length = seed.trim().length;

  const create = useMutation({
    mutationFn: async (payload: NewCase) => {
      // Start a guest session first so the create request is never sent unauthenticated.
      const user = await queryClient.fetchQuery({ queryKey: ['current-user'], queryFn: getCurrentUser });
      if (!user) queryClient.setQueryData(['current-user'], await postAuth('guest'));
      return createCase(payload);
    },
    onSuccess: (caseId) => {
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate(`/cases/${caseId}/generating`);
    },
  });
  const guest = useMutation({
    mutationFn: () => postAuth('guest'),
    onSuccess: (user: User) => {
      queryClient.setQueryData(['current-user'], user);
      navigate('/cases');
    },
  });

  return (
    <div className="home">
      <SiteHeader />
      <main className="home__main">
        <section className="home__intro">
          <h1>Every story hides a culprit.</h1>
          <p className="home__lede">
            Describe a crime in one sentence. The room writes the whole case around it: suspects with alibis, chats,
            CCTV stills, receipts and call records. Exactly one person did it, and the evidence is enough to prove who.
          </p>
          <ol className="home__steps">
            <li>
              <strong>Write the scene.</strong> One line is enough.
            </li>
            <li>
              <strong>Work the evidence.</strong> Read every chat, scrub the CCTV, tag your suspects.
            </li>
            <li>
              <strong>Name the culprit.</strong> Then see how every clue fits.
            </li>
          </ol>
          <p className="home__guest">
            No account needed.{' '}
            <button type="button" className="text-button" onClick={() => guest.mutate()} disabled={guest.isPending}>
              Play as guest
            </button>
            {guest.error && (
              <span className="form-error" role="alert">
                {' '}
                {guest.error.message}
              </span>
            )}
          </p>
        </section>

        <form
          className="case-card"
          aria-labelledby="case-card-title"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ seed: seed.trim(), difficulty, tone });
          }}
        >
          <h2 id="case-card-title" className="case-card__title">
            New case
          </h2>
          <label htmlFor="seed" className="case-card__label">
            What happened?
          </label>
          <textarea
            id="seed"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            maxLength={500}
            minLength={10}
            required
            rows={4}
            placeholder="A priceless painting vanished during the gallery’s opening night…"
          />
          <p className="case-card__count" aria-live="polite">
            {length < 10 ? `${10 - length} more characters to go` : `${length} / 500`}
          </p>

          <fieldset className="case-card__group">
            <legend>Difficulty</legend>
            <div className="choice-row">
              {DIFFICULTIES.map((option) => (
                <label key={option.value} className="choice">
                  <input
                    type="radio"
                    name="difficulty"
                    value={option.value}
                    checked={difficulty === option.value}
                    onChange={() => setDifficulty(option.value)}
                  />
                  <span className="choice__name">{difficultyLabel[option.value]}</span>
                  <span className="choice__note">{option.note}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="case-card__group">
            <legend>Tone</legend>
            <div className="choice-row choice-row--tight">
              {TONES.map((value) => (
                <label key={value} className="choice choice--pill">
                  <input
                    type="radio"
                    name="tone"
                    value={value}
                    checked={tone === value}
                    onChange={() => setTone(value)}
                  />
                  <span className="choice__name">{toneLabel[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" className="case-card__submit" disabled={length < 10 || create.isPending}>
            {create.isPending ? 'Opening the case…' : 'Open the case'}
          </button>
          {create.error && (
            <p className="form-error" role="alert">
              {create.error.message}
            </p>
          )}

          <div className="examples">
            <p className="examples__label">Need an idea?</p>
            <ul>
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button type="button" onClick={() => setSeed(example)}>
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </form>
      </main>
      <RecentCases />
      <footer className="home__footer">
        <p>All names, places and events are fictional and generated for play.</p>
      </footer>
    </div>
  );
}
