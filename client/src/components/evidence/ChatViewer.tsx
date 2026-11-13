import type { ChatContent } from '@ai-mystery-room/shared';
import { caseDate, caseDayKey, caseTime } from '../../lib/format.js';
import { Icon } from '../layout/Icon.js';

function Ticks({ status }: { status?: 'sent' | 'delivered' | 'read' }) {
  if (!status) return null;
  const label = status === 'sent' ? 'Sent' : status === 'delivered' ? 'Delivered' : 'Read';
  return (
    <span className={`chat-ticks chat-ticks--${status}`} aria-label={label} title={label}>
      {status === 'sent' ? '✓' : '✓✓'}
    </span>
  );
}

/** WhatsApp-style thread inside a phone frame (spec §12.4). */
export function ChatViewer({ content, source }: { content: ChatContent; source: string }) {
  const owner = content.participants[0];
  const others = content.participants.filter((name) => name !== owner);
  const heading = others.length === 1 ? others[0] : others.join(', ');
  let lastDay = '';
  let lastSender = '';

  return (
    <div className="phone" role="group" aria-label={`Chat between ${content.participants.join(', ')}`}>
      <div className="phone__notch" aria-hidden="true" />
      <header className="phone__header">
        <span className="phone__avatar" aria-hidden="true">
          {heading.slice(0, 1)}
        </span>
        <div>
          <p className="phone__contact">{heading}</p>
          <p className="phone__sub">
            {others.length > 1 ? `Group · ${content.participants.length} people` : `Viewed on ${owner}'s phone`}
          </p>
        </div>
      </header>
      <ol className="phone__thread">
        {content.messages.map((message, index) => {
          const day = caseDayKey(message.timestamp);
          const showDay = day !== lastDay;
          const mine = message.sender === owner;
          const showSender = !mine && others.length > 1 && message.sender !== lastSender;
          lastDay = day;
          lastSender = message.sender;
          return (
            <li key={index} className="chat-row-wrap">
              {showDay && <p className="chat-day">{caseDate(message.timestamp)}</p>}
              <div className={`chat-row ${mine ? 'chat-row--mine' : ''}`}>
                <div className={`bubble ${mine ? 'bubble--mine' : ''} ${message.deleted ? 'bubble--deleted' : ''}`}>
                  {showSender && <p className="bubble__sender">{message.sender}</p>}
                  {message.deleted ? (
                    <p className="bubble__text">
                      <Icon name="deleted" size={14} /> This message was deleted
                    </p>
                  ) : (
                    <p className="bubble__text">{message.text}</p>
                  )}
                  <p className="bubble__meta">
                    <span className="sr-only">{message.sender}, </span>
                    {caseTime(message.timestamp)}
                    {mine && <Ticks status={message.status} />}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="phone__source">{source}</p>
    </div>
  );
}
