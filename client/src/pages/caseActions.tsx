import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { PlayerCaseView } from '@ai-mystery-room/shared';
import { accuse, giveUp } from '../api/cases.js';
import { Portrait } from '../components/suspects/SuspectCard.js';
import { Icon } from '../components/layout/Icon.js';

type Step = 'choose' | 'confirm' | 'giveup';

/** Accusation flow (spec §12.5): choose a suspect, optional reasoning, explicit confirmation. */
function AccuseDialog({ data, open, onClose }: { data: PlayerCaseView; open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('choose');
  const [suspectId, setSuspectId] = useState<string>();
  const [reasoning, setReasoning] = useState('');
  const [nudge, setNudge] = useState<string>();
  const suspect = data.suspects.find((item) => item.id === suspectId);

  useEffect(() => {
    if (open) {
      setStep('choose');
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [open]);

  const finish = (view: PlayerCaseView) => {
    queryClient.setQueryData(['case', data.id], view);
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
    onClose();
    navigate(`/cases/${data.id}/verdict`);
  };

  const submit = useMutation({
    mutationFn: () => accuse(data.id, suspectId ?? '', reasoning.trim() || undefined),
    onSuccess: (result) => {
      if (result.resolved) return finish(result.case);
      setNudge(result.message);
      setStep('choose');
      const accused = suspectId ?? '';
      queryClient.setQueryData<PlayerCaseView>(['case', data.id], (current) =>
        current
          ? {
              ...current,
              status: 'in_progress',
              attemptsRemaining: result.attemptsRemaining,
              accusations: [
                ...current.accusations,
                { suspectId: accused, at: new Date().toISOString(), correct: false },
              ],
            }
          : current,
      );
      setSuspectId(undefined);
    },
  });
  const reveal = useMutation({ mutationFn: () => giveUp(data.id), onSuccess: finish });
  const attempts = data.attemptsRemaining;

  return (
    <dialog ref={dialog} className="accuse" onClose={onClose} aria-labelledby="accuse-title">
      <header className="accuse__head">
        <h2 id="accuse-title">
          {step === 'giveup' ? 'Close the case without an answer?' : step === 'confirm' ? 'Final check' : 'Who did it?'}
        </h2>
        <button type="button" className="accuse__close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>

      {step === 'choose' && (
        <form
          className="accuse__body"
          onSubmit={(event) => {
            event.preventDefault();
            if (suspectId) setStep('confirm');
          }}
        >
          {nudge && (
            <p className="accuse__nudge" role="alert">
              {nudge} You have {attempts} {attempts === 1 ? 'attempt' : 'attempts'} left.
            </p>
          )}
          <fieldset className="lineup">
            <legend className="sr-only">Choose a suspect</legend>
            {data.suspects.map((item) => {
              const accusedBefore = data.accusations.some((accusation) => accusation.suspectId === item.id);
              return (
                <label key={item.id} className={`lineup__card ${suspectId === item.id ? 'is-chosen' : ''}`}>
                  <input
                    type="radio"
                    name="suspect"
                    value={item.id}
                    checked={suspectId === item.id}
                    onChange={() => setSuspectId(item.id)}
                    disabled={accusedBefore}
                  />
                  <Portrait caseId={data.id} suspect={item} size="lg" />
                  <span className="lineup__name">{item.name}</span>
                  <span className="lineup__role">{accusedBefore ? 'Already accused' : item.role}</span>
                </label>
              );
            })}
          </fieldset>
          <label className="accuse__reason">
            Your reasoning (optional)
            <textarea
              value={reasoning}
              maxLength={500}
              onChange={(event) => setReasoning(event.target.value)}
              placeholder="What gave them away?"
            />
            <span className="muted">{reasoning.length}/500</span>
          </label>
          <div className="accuse__actions">
            <button type="button" className="text-button" onClick={() => setStep('giveup')}>
              Give up and reveal the answer
            </button>
            <button type="submit" className="primary-button" disabled={!suspectId}>
              Continue
            </button>
          </div>
        </form>
      )}

      {step === 'confirm' && suspect && (
        <div className="accuse__body accuse__confirm">
          <Portrait caseId={data.id} suspect={suspect} size="lg" />
          <p>
            You have {attempts} {attempts === 1 ? 'attempt' : 'attempts'} left. Accuse <strong>{suspect.name}</strong>?
          </p>
          {attempts === 1 && <p className="muted">If you are wrong, the case closes and the answer is revealed.</p>}
          {submit.error && (
            <p className="form-error" role="alert">
              {submit.error.message}
            </p>
          )}
          <div className="accuse__actions">
            <button type="button" className="text-button" onClick={() => setStep('choose')}>
              Go back
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? 'Checking the evidence…' : `Accuse ${suspect.name}`}
            </button>
          </div>
        </div>
      )}

      {step === 'giveup' && (
        <div className="accuse__body accuse__confirm">
          <p>The full solution will be shown and this case will score 0. You cannot reopen it.</p>
          {reveal.error && (
            <p className="form-error" role="alert">
              {reveal.error.message}
            </p>
          )}
          <div className="accuse__actions">
            <button type="button" className="text-button" onClick={() => setStep('choose')}>
              Keep investigating
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={reveal.isPending}
              onClick={() => reveal.mutate()}
            >
              Reveal the answer
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

export function useCaseActions(data: PlayerCaseView | undefined) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const resolved = data?.status === 'resolved';
  function AccuseButton() {
    if (resolved && data)
      return (
        <button type="button" className="primary-button" onClick={() => navigate(`/cases/${data.id}/verdict`)}>
          See the solution
        </button>
      );
    return (
      <button type="button" className="primary-button" disabled={!data} onClick={() => setOpen(true)}>
        Make accusation
      </button>
    );
  }
  const accuseDialog =
    data && !resolved ? <AccuseDialog data={data} open={open} onClose={() => setOpen(false)} /> : null;
  return { AccuseButton, accuseDialog };
}
