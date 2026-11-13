import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { Difficulty, Tone } from '@ai-mystery-room/shared';
import { getCurrentUser, postAuth, type User } from '../api/auth.js';
import { createCase } from '../api/cases.js';

export default function HomePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [seed, setSeed] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [tone, setTone] = useState<Tone>('classic_noir');
  const create = useMutation({
    mutationFn: async (payload: { seed: string; difficulty: Difficulty; tone: Tone }) => {
      // Start a guest session first so the create request is never sent unauthenticated.
      const user = await queryClient.fetchQuery({ queryKey: ['current-user'], queryFn: getCurrentUser });
      if (!user) queryClient.setQueryData(['current-user'], await postAuth('guest'));
      return createCase(payload);
    },
    onSuccess: async (caseId) => {
      await queryClient.invalidateQueries({ queryKey: ['current-user'] });
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
