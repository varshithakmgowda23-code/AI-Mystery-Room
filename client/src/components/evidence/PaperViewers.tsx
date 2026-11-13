import Markdown from 'react-markdown';
import type { CallLogContent, DocumentContent, EmailContent } from '@ai-mystery-room/shared';
import { caseDate, caseTime, duration } from '../../lib/format.js';
import { Icon } from '../layout/Icon.js';

const docKindLabel: Record<DocumentContent['docKind'], string> = {
  receipt: 'Receipt',
  note: 'Handwritten note',
  report: 'Report',
  ticket: 'Ticket',
  bank_statement: 'Bank statement',
};

/** AI text is rendered as markdown only: raw HTML, images and links are never rendered (spec §15.3). */
export function DocumentViewer({ content }: { content: DocumentContent }) {
  return (
    <article className={`paper paper--${content.docKind}`} aria-label={docKindLabel[content.docKind]}>
      <Markdown skipHtml disallowedElements={['img', 'a', 'script', 'iframe']} unwrapDisallowed>
        {/* Models often use single newlines for lines; keep them as line breaks. */}
        {content.contentMarkdown.replace(/([^\n])\n(?!\n)/g, '$1  \n')}
      </Markdown>
    </article>
  );
}

export function CallLogViewer({ content }: { content: CallLogContent }) {
  const label = { in: 'Incoming', out: 'Outgoing', missed: 'Missed' } as const;
  const icon = { in: 'incoming', out: 'outgoing', missed: 'missed' } as const;
  return (
    <article className="printout">
      <header className="printout__head">
        <p>Call records</p>
        <p className="printout__owner">{content.owner}</p>
      </header>
      <table className="calls">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Contact</th>
            <th scope="col">Time</th>
            <th scope="col">Length</th>
          </tr>
        </thead>
        <tbody>
          {content.entries.map((entry, index) => (
            <tr key={index} className={`calls__row calls__row--${entry.direction}`}>
              <td>
                <span className="calls__dir">
                  <Icon name={icon[entry.direction]} size={15} /> {label[entry.direction]}
                </span>
              </td>
              <td>{entry.contact}</td>
              <td>
                <time dateTime={entry.time}>{caseTime(entry.time)}</time>
              </td>
              <td>{entry.direction === 'missed' ? '—' : duration(entry.durationSec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

export function EmailViewer({ content }: { content: EmailContent }) {
  return (
    <article className="email">
      <h3 className="email__subject">{content.subject}</h3>
      <dl className="email__head">
        <div>
          <dt>From</dt>
          <dd>{content.from}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{content.to.join(', ')}</dd>
        </div>
        <div>
          <dt>Sent</dt>
          <dd>
            <time dateTime={content.sentAt}>
              {caseDate(content.sentAt)}, {caseTime(content.sentAt)}
            </time>
          </dd>
        </div>
      </dl>
      <div className="email__body">{content.bodyText}</div>
    </article>
  );
}
