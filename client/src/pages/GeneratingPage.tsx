import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getCaseStatus, isPlayable, regenerateCase, safeGenerationErrorMessage } from '../api/cases.js';
import { SiteHeader } from '../components/layout/SiteHeader.js';
import { Icon } from '../components/layout/Icon.js';

/** Spec §6.1 step 3 stage labels, mapped onto the server's generation stages. */
const STEPS = [
  { label: 'Drafting the crime', stages: ['queued', 'blueprint'], until: 15 },
  { label: 'Creating suspects', stages: ['blueprint'], until: 25 },
  { label: 'Fabricating evidence', stages: ['evidence', 'media'], until: 90 },
  { label: 'Verifying the case is solvable', stages: ['validation', 'complete'], until: 100 },
];

function stepIndex(percent: number) {
  const index = STEPS.findIndex((step) => percent < step.until);
  return index === -1 ? STEPS.length - 1 : index;
}

export default function GeneratingPage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['case-status', caseId],
    queryFn: () => getCaseStatus(caseId),
    enabled: Boolean(caseId),
    retry: 1,
    refetchInterval: (query) =>
      isPlayable(query.state.data?.status) || query.state.data?.status === 'failed' ? false : 2000,
  });
  const retry = useMutation({
    mutationFn: () => regenerateCase(caseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case-status', caseId] }),
  });
  useEffect(() => {
    if (isPlayable(status.data?.status)) navigate(`/cases/${caseId}`, { replace: true });
  }, [caseId, navigate, status.data?.status]);

  const failed = status.data?.status === 'failed';
  const percent = status.data?.progress.percent ?? 0;
  const current = stepIndex(percent);

  return (
    <div className="auth-page">
      <SiteHeader />
      <main className="auth-main">
        <section className="auth-panel generating" aria-labelledby="generating-title">
          <h1 id="generating-title">{failed ? 'The trail went cold.' : 'Building your case.'}</h1>
          {failed ? (
            <p className="auth-copy" role="alert">
              {safeGenerationErrorMessage(status.data?.error)}
            </p>
          ) : (
            <p className="auth-copy">
              This usually takes one to two minutes. You can leave this page; the case will be waiting in My cases.
            </p>
          )}

          {!failed && (
            <>
              <ol className="steps" aria-label="Progress">
                {STEPS.map((step, index) => {
                  const state = index < current ? 'done' : index === current ? 'active' : 'todo';
                  return (
                    <li
                      key={step.label}
                      className={`steps__item steps__item--${state}`}
                      aria-current={state === 'active' ? 'step' : undefined}
                    >
                      <span className="steps__mark" aria-hidden="true">
                        {state === 'done' ? <Icon name="check" size={14} /> : index + 1}
                      </span>
                      {step.label}
                      {state === 'active' && (
                        <span className="typing" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Case generation progress"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${Math.max(4, percent)}%` }} />
              </div>
            </>
          )}

          {failed && (
            <div className="generating__actions">
              {status.data?.errorCode !== 'CONTENT_POLICY' && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => retry.mutate()}
                  disabled={retry.isPending}
                >
                  {retry.isPending ? 'Reopening…' : 'Retry this case'}
                </button>
              )}
              <Link className="text-button" to="/">
                Try a different case
              </Link>
            </div>
          )}
          {retry.error && (
            <p className="form-error" role="alert">
              {retry.error.message}
            </p>
          )}
          {status.error && (
            <p className="form-error" role="alert">
              {safeGenerationErrorMessage(status.error.message)}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
