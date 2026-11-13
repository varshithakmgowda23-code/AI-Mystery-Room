import { useEffect, useRef, useState } from 'react';
import type { ImageContent } from '@ai-mystery-room/shared';
import { caseDate, caseTime } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media.js';
import { Icon } from '../layout/Icon.js';

/** Photo evidence with click-to-zoom; without a generated image the written description is the evidence. */
export function ImageViewer({ caseId, content }: { caseId: string; content: ImageContent }) {
  const src = mediaUrl(caseId, content.imageUrl);
  const [zoomed, setZoomed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (zoomed) dialog.current?.showModal();
    else dialog.current?.close();
  }, [zoomed]);

  const meta = content.metadata;
  return (
    <figure className="photo">
      <div className="photo__print">
        {src ? (
          <button type="button" className="photo__zoom" onClick={() => setZoomed(true)} aria-label="Enlarge photo">
            <img src={src} alt={content.altText} loading="lazy" />
            <span className="photo__zoom-icon">
              <Icon name="zoom" />
            </span>
          </button>
        ) : (
          <div className="photo__described">
            <p className="photo__described-label">Photograph on file, description from the evidence log</p>
            <p className="photo__described-text">{content.altText}</p>
          </div>
        )}
      </div>
      <figcaption className="photo__caption">{content.caption}</figcaption>
      {meta && (meta.takenAt || meta.location || meta.device) && (
        <dl className="chips">
          {meta.takenAt && (
            <div className="chip">
              <dt>Taken</dt>
              <dd>
                {caseDate(meta.takenAt) || meta.takenAt} {caseTime(meta.takenAt)}
              </dd>
            </div>
          )}
          {meta.location && (
            <div className="chip">
              <dt>Location</dt>
              <dd>{meta.location}</dd>
            </div>
          )}
          {meta.device && (
            <div className="chip">
              <dt>Device</dt>
              <dd>{meta.device}</dd>
            </div>
          )}
        </dl>
      )}
      {src && (
        <dialog ref={dialog} className="lightbox" onClose={() => setZoomed(false)} aria-label="Enlarged photo">
          <button type="button" className="lightbox__close" onClick={() => setZoomed(false)} aria-label="Close">
            <Icon name="close" />
          </button>
          <img src={src} alt={content.altText} />
        </dialog>
      )}
    </figure>
  );
}
