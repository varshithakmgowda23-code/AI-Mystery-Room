import { useState } from 'react';
import type { PlayerSuspect, SuspectTag } from '@ai-mystery-room/shared';
import { mediaUrl } from '../../lib/media.js';

const tagLabel: Record<SuspectTag, string> = { unknown: 'Open', suspicious: 'Suspicious', cleared: 'Cleared' };

export function Portrait({
  caseId,
  suspect,
  size = 'md',
}: {
  caseId: string;
  suspect: PlayerSuspect;
  size?: 'md' | 'lg';
}) {
  const src = mediaUrl(caseId, suspect.portraitUrl);
  const initials = suspect.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('');
  return (
    <span className={`portrait portrait--${size}`} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : <span className="portrait__initials">{initials}</span>}
    </span>
  );
}

/** Suspect profile with player-only tags (FR-19). */
export function SuspectCard({
  caseId,
  suspect,
  tag,
  onTag,
  readOnly,
}: {
  caseId: string;
  suspect: PlayerSuspect;
  tag: SuspectTag;
  onTag: (tag: SuspectTag) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`suspect suspect--${tag}`} aria-labelledby={`suspect-${suspect.id}`}>
      <div className="suspect__top">
        <Portrait caseId={caseId} suspect={suspect} />
        <div className="suspect__id">
          <h3 id={`suspect-${suspect.id}`}>{suspect.name}</h3>
          <p>
            {suspect.role}, {suspect.age}
          </p>
        </div>
        {tag !== 'unknown' && <span className={`stamp stamp--${tag}`}>{tagLabel[tag]}</span>}
      </div>
      <p className="suspect__alibi">
        <span>Alibi</span> {suspect.alibi}
      </p>
      {open && <p className="suspect__bio">{suspect.description}</p>}
      <div className="suspect__actions">
        <button type="button" className="text-button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? 'Hide profile' : 'Read profile'}
        </button>
        {!readOnly && (
          <div className="seg seg--small" role="group" aria-label={`Your view of ${suspect.name}`}>
            {(['unknown', 'suspicious', 'cleared'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={tag === value} onClick={() => onTag(value)}>
                {tagLabel[value]}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
