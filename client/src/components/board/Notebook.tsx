import { useEffect, useRef, useState } from 'react';
import { saveNotes } from '../../api/cases.js';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
const label: Record<SaveState, string> = {
  saved: 'Saved',
  dirty: 'Editing…',
  saving: 'Saving…',
  error: 'Not saved. Keep typing to retry.',
};

/** Free-text notes, autosaved 1 s after typing stops (FR-18). */
export function Notebook({ caseId, initial, readOnly }: { caseId: string; initial: string; readOnly?: boolean }) {
  const [notes, setNotes] = useState(initial);
  const [state, setState] = useState<SaveState>('saved');
  const latest = useRef(initial);

  useEffect(() => {
    if (state !== 'dirty') return;
    const timer = window.setTimeout(async () => {
      const value = latest.current;
      setState('saving');
      try {
        await saveNotes(caseId, value);
        setState(latest.current === value ? 'saved' : 'dirty');
      } catch {
        setState('error');
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [caseId, notes, state]);

  return (
    <section className="notebook" aria-labelledby="notebook-title">
      <div className="panel-head">
        <h2 id="notebook-title">Notebook</h2>
        {!readOnly && (
          <p className={`save-state save-state--${state}`} role="status" aria-live="polite">
            {label[state]}
          </p>
        )}
      </div>
      <textarea
        aria-labelledby="notebook-title"
        value={notes}
        readOnly={readOnly}
        maxLength={10_000}
        placeholder="Who was where, and when? Note contradictions as you find them."
        onChange={(event) => {
          latest.current = event.target.value;
          setNotes(event.target.value);
          setState('dirty');
        }}
      />
    </section>
  );
}
