import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  genericGenerationError,
  getCaseStatus,
  isPlayable,
  regenerateCase,
  safeGenerationErrorMessage,
} from '../api/cases.js';

export default function GeneratingPage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const status = useQuery({
    queryKey: ['case-status', caseId],
    queryFn: () => getCaseStatus(caseId),
    enabled: Boolean(caseId),
    retry: false,
    refetchInterval: (query) =>
      isPlayable(query.state.data?.status) || query.state.data?.status === 'failed' ? false : 2000,
  });
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => regenerateCase(caseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case-status', caseId] }),
  });
  useEffect(() => {
    if (status.data?.status === 'failed' && !status.data.errorCode && status.data.error === genericGenerationError) {
      void status.refetch();
    }
  }, [status.data?.status, status.data?.errorCode, status.data?.error, status.refetch]);
  useEffect(() => {
    if (isPlayable(status.data?.status)) navigate(`/cases/${caseId}`, { replace: true });
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
          <>
            {status.data.errorCode !== 'CONTENT_POLICY' && (
              <button
                type="button"
                className="form-submit inline-submit"
                onClick={() => retry.mutate()}
                disabled={retry.isPending}
              >
                {retry.isPending ? 'REOPENING…' : 'RETRY THIS CASE'} <span aria-hidden="true">↻</span>
              </button>
            )}
            <Link className="back-link" to="/">
              ← Try a different case
            </Link>
            {retry.error && (
              <p className="form-error" role="alert">
                {retry.error.message}
              </p>
            )}
          </>
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
