import { useMemo, useState } from 'react';
import type { EvidenceType, PlayerEvidence } from '@ai-mystery-room/shared';
import { caseTime } from '../../lib/format.js';
import { evidenceTypeLabel, Icon } from '../layout/Icon.js';

type Filter = 'all' | 'unviewed' | EvidenceType;

/** Evidence index with type filters and a chronological timeline built from player-visible times only. */
export function EvidenceList({
  evidence,
  selectedId,
  onSelect,
}: {
  evidence: PlayerEvidence[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [mode, setMode] = useState<'file' | 'timeline'>('file');
  const types = useMemo(() => [...new Set(evidence.map((item) => item.type))], [evidence]);
  const unviewed = evidence.filter((item) => !item.viewed).length;

  const visible = useMemo(() => {
    const filtered = evidence.filter((item) =>
      filter === 'all' ? true : filter === 'unviewed' ? !item.viewed : item.type === filter,
    );
    return mode === 'timeline' ? [...filtered].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)) : filtered;
  }, [evidence, filter, mode]);

  return (
    <section className="evidence-index" aria-labelledby="evidence-index-title">
      <div className="panel-head">
        <h2 id="evidence-index-title">Evidence</h2>
        <div className="seg" role="group" aria-label="Order evidence">
          <button type="button" aria-pressed={mode === 'file'} onClick={() => setMode('file')}>
            Case file
          </button>
          <button type="button" aria-pressed={mode === 'timeline'} onClick={() => setMode('timeline')}>
            Timeline
          </button>
        </div>
      </div>
      <div className="filters" role="group" aria-label="Filter evidence">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All {evidence.length}
        </button>
        <button type="button" aria-pressed={filter === 'unviewed'} onClick={() => setFilter('unviewed')}>
          Unread {unviewed}
        </button>
        {types.map((type) => (
          <button key={type} type="button" aria-pressed={filter === type} onClick={() => setFilter(type)}>
            {evidenceTypeLabel[type]}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="empty-note">
          {filter === 'unviewed' ? 'You have examined every item. Time to decide.' : 'Nothing matches this filter.'}
        </p>
      ) : (
        <ol className={`evidence-items ${mode === 'timeline' ? 'evidence-items--timeline' : ''}`}>
          {visible.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`evidence-item ${item.id === selectedId ? 'is-selected' : ''} ${item.viewed ? 'is-viewed' : ''}`}
                aria-current={item.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
              >
                {mode === 'timeline' && <time className="evidence-item__time">{caseTime(item.occurredAt)}</time>}
                <span className={`evidence-item__icon type-${item.type}`}>
                  <Icon name={item.type} size={16} />
                </span>
                <span className="evidence-item__text">
                  <span className="evidence-item__title">{item.title}</span>
                  <span className="evidence-item__summary">{item.summary}</span>
                </span>
                {!item.viewed && (
                  <span className="unread-dot" title="Not examined yet">
                    <span className="sr-only">Not examined yet</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
