import type { PlayerEvidence } from '@ai-mystery-room/shared';
import { caseDate, caseTime } from '../../lib/format.js';
import { evidenceTypeLabel, Icon } from '../layout/Icon.js';
import { ChatViewer } from './ChatViewer.js';
import { CctvPlayer } from './CctvPlayer.js';
import { ImageViewer } from './ImageViewer.js';
import { CallLogViewer, DocumentViewer, EmailViewer } from './PaperViewers.js';

function Body({ caseId, item }: { caseId: string; item: PlayerEvidence }) {
  switch (item.type) {
    case 'chat':
      return <ChatViewer content={item.content} source={item.source} />;
    case 'image':
      return <ImageViewer caseId={caseId} content={item.content} />;
    case 'cctv':
      return <CctvPlayer caseId={caseId} content={item.content} />;
    case 'document':
      return <DocumentViewer content={item.content} />;
    case 'call_log':
      return <CallLogViewer content={item.content} />;
    case 'email':
      return <EmailViewer content={item.content} />;
  }
}

/** Full-size view of one evidence item. Keyed by id so each item opens with a fresh animation. */
export function EvidenceViewer({ caseId, item, position }: { caseId: string; item: PlayerEvidence; position: string }) {
  return (
    <article className="viewer" key={item.id} aria-labelledby={`viewer-title-${item.id}`}>
      <header className="viewer__head">
        <p className="viewer__kind">
          <Icon name={item.type} size={16} /> {evidenceTypeLabel[item.type]} <span>{position}</span>
        </p>
        <h2 id={`viewer-title-${item.id}`}>{item.title}</h2>
        <p className="viewer__summary">{item.summary}</p>
        <p className="viewer__meta">
          <span>
            <Icon name="clock" size={14} /> {caseDate(item.occurredAt)}, {caseTime(item.occurredAt)}
          </span>
          <span>
            <Icon name="pin" size={14} /> {item.source}
          </span>
        </p>
      </header>
      <div className={`viewer__body viewer__body--${item.type}`}>
        <Body caseId={caseId} item={item} />
      </div>
    </article>
  );
}
