import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { PlayerCaseView, SuspectTag } from '@ai-mystery-room/shared';
import { getCase, markEvidenceViewed, revealHint, saveSuspectTags } from '../api/cases.js';
import { ApiError } from '../api/http.js';
import { EvidenceList } from '../components/evidence/EvidenceList.js';
import { EvidenceViewer } from '../components/evidence/EvidenceViewer.js';
import { HintsPanel } from '../components/board/HintsPanel.js';
import { Notebook } from '../components/board/Notebook.js';
import { SuspectCard } from '../components/suspects/SuspectCard.js';
import { Icon } from '../components/layout/Icon.js';
import { caseDate, difficultyLabel, elapsed } from '../lib/format.js';
import { useCaseActions } from './caseActions.js';

type Tab = 'briefing' | 'suspects' | 'evidence' | 'notebook';
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'suspects', label: 'Suspects' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'notebook', label: 'Notebook' },
];

function useClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function Briefing({ data }: { data: PlayerCaseView }) {
  return (
    <section className="briefing" aria-labelledby="case-title">
      <p className="briefing__place">
        {data.setting.location}
        <span>
          {caseDate(`${data.setting.date}T00:00:00+00:00`) || data.setting.date}, {data.setting.timeframe}
        </span>
      </p>
      <h1 id="case-title">{data.title}</h1>
      <p className="briefing__text">{data.briefing}</p>
    </section>
  );
}

function BoardSkeleton() {
  return (
    <main className="board board--loading" aria-busy="true" aria-label="Opening the case file">
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--block" />
      <div className="skeleton skeleton--block" />
    </main>
  );
}

function BoardMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" role="alert">
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

export default function CaseBoardPage() {
  const { caseId = '' } = useParams();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('briefing');
  const query = useQuery({ queryKey: ['case', caseId], queryFn: () => getCase(caseId), retry: false });
  const data = query.data;
  const resolved = data?.status === 'resolved';
  const now = useClock(Boolean(data) && !resolved);
  const selectedId = params.get('e') ?? undefined;
  const { AccuseButton, accuseDialog } = useCaseActions(data);

  const patchCase = (update: (current: PlayerCaseView) => PlayerCaseView) =>
    queryClient.setQueryData<PlayerCaseView>(['case', caseId], (current) => (current ? update(current) : current));

  const viewed = useMutation({
    mutationFn: (evidenceId: string) => markEvidenceViewed(caseId, evidenceId),
    onMutate: (evidenceId) =>
      patchCase((current) => ({
        ...current,
        evidence: current.evidence.map((item) => (item.id === evidenceId ? { ...item, viewed: true } : item)),
      })),
  });
  const tags = useMutation({
    mutationFn: (next: Record<string, SuspectTag>) => saveSuspectTags(caseId, next),
    onMutate: (next) => patchCase((current) => ({ ...current, suspectTags: next })),
    onError: () => void queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
  });
  const hint = useMutation({
    mutationFn: () => revealHint(caseId),
    onSuccess: ({ hint: text, hintsUsed }) =>
      patchCase((current) => ({ ...current, hintsUsed, revealedHints: [...current.revealedHints, text] })),
  });

  const selected = useMemo(() => data?.evidence.find((item) => item.id === selectedId), [data, selectedId]);
  const selectedPosition = data && selected ? `${data.evidence.indexOf(selected) + 1} of ${data.evidence.length}` : '';

  useEffect(() => {
    if (selectedId) setTab('evidence');
  }, [selectedId]);

  useEffect(() => {
    if (selected && !selected.viewed && !resolved && !viewed.isPending) viewed.mutate(selected.id);
  }, [selected, resolved, viewed]);

  if (query.isLoading) return <BoardSkeleton />;
  if (query.error) {
    const error = query.error as ApiError;
    if (error.status === 401) return <Navigate to="/login" replace />;
    if (error.status === 404)
      return (
        <BoardMessage title="This case file does not exist.">
          <p className="auth-copy">It may have been deleted, or it belongs to another detective.</p>
          <Link className="form-submit inline-submit" to="/cases">
            Go to my cases
          </Link>
        </BoardMessage>
      );
    return (
      <BoardMessage title="The case file would not open.">
        <p className="auth-copy">{error.message}</p>
        <button type="button" className="form-submit inline-submit" onClick={() => void query.refetch()}>
          Try again
        </button>
      </BoardMessage>
    );
  }
  if (!data) return null;
  if (data.status === 'queued' || data.status === 'generating' || data.status === 'failed')
    return <Navigate to={`/cases/${caseId}/generating`} replace />;

  const viewedCount = data.evidence.filter((item) => item.viewed).length;
  const select = (id: string | undefined) => {
    const next = new URLSearchParams(params);
    if (id) next.set('e', id);
    else next.delete('e');
    setParams(next, { replace: false });
  };
  const setTag = (suspectId: string, value: SuspectTag) => tags.mutate({ ...data.suspectTags, [suspectId]: value });

  const suspects = (
    <section className="suspects" aria-labelledby="suspects-title">
      <div className="panel-head">
        <h2 id="suspects-title">Suspects</h2>
        <p className="muted">{data.suspects.length} people with access</p>
      </div>
      {data.suspects.map((suspect) => (
        <SuspectCard
          key={suspect.id}
          caseId={caseId}
          suspect={suspect}
          tag={data.suspectTags[suspect.id] ?? 'unknown'}
          onTag={(value) => setTag(suspect.id, value)}
          readOnly={resolved}
        />
      ))}
    </section>
  );
  const evidenceList = <EvidenceList evidence={data.evidence} selectedId={selectedId} onSelect={select} />;
  const notebook = <Notebook caseId={caseId} initial={data.notes} readOnly={resolved} />;
  const hints = (
    <HintsPanel
      hints={data.revealedHints}
      available={data.hintsAvailable}
      onReveal={() => hint.mutate()}
      pending={hint.isPending}
      error={hint.error?.message}
      readOnly={resolved}
    />
  );

  return (
    <div className="board-shell">
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

      {resolved && (
        <div className="resolved-banner" role="status">
          This case is closed. The board is read-only.
          <Link to={`/cases/${caseId}/verdict`}>See the solution</Link>
        </div>
      )}

      <nav className="board-tabs" aria-label="Case sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => {
              setTab(item.id);
              if (item.id !== 'evidence') select(undefined);
            }}
          >
            {item.label}
            {item.id === 'evidence' && <span className="tab-count">{data.evidence.length - viewedCount}</span>}
          </button>
        ))}
      </nav>

      <main className={`board board--tab-${tab} ${selected ? 'board--viewing' : ''}`}>
        <aside className="board__left">
          <Briefing data={data} />
          {suspects}
        </aside>

        <section className="board__center" aria-label="Evidence viewer">
          {selected ? (
            <>
              <button type="button" className="viewer-back" onClick={() => select(undefined)}>
                <Icon name="back" size={16} /> All evidence
              </button>
              <EvidenceViewer key={selected.id} caseId={caseId} item={selected} position={selectedPosition} />
            </>
          ) : (
            <div className="viewer-empty">
              <p className="viewer-empty__title">Pick up the first piece of evidence.</p>
              <p>
                {data.evidence.length} items were recovered. Read them in any order, tag the suspects as you go, and
                accuse someone when the story holds together.
              </p>
              <button type="button" className="primary-button" onClick={() => select(data.evidence[0]?.id)}>
                Open the first item
              </button>
            </div>
          )}
        </section>

        <aside className="board__right">
          {evidenceList}
          {notebook}
          {hints}
        </aside>
      </main>

      <footer className="board-bar">
        <div className="progress-mini" aria-label={`${viewedCount} of ${data.evidence.length} items examined`}>
          <span className="progress-mini__track">
            <span style={{ width: `${(viewedCount / Math.max(1, data.evidence.length)) * 100}%` }} />
          </span>
          <span>
            {viewedCount}/{data.evidence.length} examined
          </span>
        </div>
        <p className="board-bar__time" aria-label="Time on case">
          <Icon name="clock" size={15} /> {resolved ? 'Closed' : elapsed(data.startedAt, now)}
        </p>
        <AccuseButton />
      </footer>
      {accuseDialog}
    </div>
  );
}
