import { useState } from 'react';
import { Icon } from '../layout/Icon.js';

/** Escalating hints; each one costs 100 points (FR-20, spec §14). */
export function HintsPanel({
  hints,
  available,
  onReveal,
  pending,
  error,
  readOnly,
}: {
  hints: string[];
  available: number;
  onReveal: () => void;
  pending: boolean;
  error?: string;
  readOnly?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const left = available - hints.length;
  return (
    <section className="hints" aria-labelledby="hints-title">
      <div className="panel-head">
        <h2 id="hints-title">Hints</h2>
        <p className="muted">{left > 0 ? `${left} left` : 'None left'}</p>
      </div>
      {hints.length > 0 && (
        <ol className="hints__list">
          {hints.map((hint, index) => (
            <li key={index}>
              <Icon name="bulb" size={16} /> {hint}
            </li>
          ))}
        </ol>
      )}
      {!readOnly && left > 0 && !confirming && (
        <button type="button" className="ghost-button" onClick={() => setConfirming(true)}>
          {hints.length === 0 ? 'Ask for a hint' : 'Ask for a sharper hint'}
        </button>
      )}
      {confirming && (
        <div className="confirm-inline" role="group" aria-label="Confirm hint">
          <p>A hint costs 100 points from your final score.</p>
          <div>
            <button
              type="button"
              className="primary-button"
              disabled={pending}
              onClick={() => {
                onReveal();
                setConfirming(false);
              }}
            >
              Reveal hint
            </button>
            <button type="button" className="text-button" onClick={() => setConfirming(false)}>
              Keep thinking
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
