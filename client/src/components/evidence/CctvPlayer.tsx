import { useEffect, useState } from 'react';
import type { CctvContent } from '@ai-mystery-room/shared';
import { caseDateShort, caseTimeWithSeconds } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media.js';
import { Icon } from '../layout/Icon.js';

const FRAME_MS = 1500;

/** Frame-by-frame CCTV player with a CSS overlay so text is always legible (spec §9 Stage 3, §12.4). */
export function CctvPlayer({ caseId, content }: { caseId: string; content: CctvContent }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = content.frames.length;
  const frame = content.frames[Math.min(index, total - 1)];
  const src = mediaUrl(caseId, frame?.imageUrl);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (index >= total - 1) setPlaying(false);
      else setIndex(index + 1);
    }, FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, total]);

  if (!frame) return null;
  const go = (next: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(total - 1, next)));
  };

  return (
    <div className="cctv">
      <div className="cctv__monitor">
        <div
          className="cctv__screen"
          role="img"
          aria-label={`Camera ${content.cameraId}, frame ${index + 1} of ${total}. ${frame.note ?? ''}`}
        >
          {src ? (
            <img src={src} alt="" loading="lazy" />
          ) : (
            <div className="cctv__scene" aria-hidden="true">
              <p>{frame.note ?? 'No movement recorded in this frame.'}</p>
            </div>
          )}
          <div className="cctv__grain" aria-hidden="true" />
          <div className="cctv__hud" aria-hidden="true">
            <span className="cctv__rec">
              <i /> REC
            </span>
            <span>{content.cameraId}</span>
            <span className="cctv__loc">{content.location}</span>
            <span className="cctv__time">
              {caseDateShort(frame.timestamp)} {caseTimeWithSeconds(frame.timestamp)}
            </span>
          </div>
        </div>
        <div className="cctv__controls">
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous frame">
            <Icon name="prev" />
          </button>
          <button
            type="button"
            className="cctv__play"
            onClick={() => {
              if (index >= total - 1) setIndex(0);
              setPlaying((value) => !value);
            }}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <button type="button" onClick={() => go(index + 1)} disabled={index === total - 1} aria-label="Next frame">
            <Icon name="next" />
          </button>
          <input
            type="range"
            min={0}
            max={total - 1}
            value={index}
            onChange={(event) => go(Number(event.target.value))}
            aria-label="Scrub through frames"
            aria-valuetext={`Frame ${index + 1} of ${total}, ${caseTimeWithSeconds(frame.timestamp)}`}
          />
          <span className="cctv__count">
            {index + 1}/{total}
          </span>
        </div>
      </div>
      {src && frame.note && <p className="cctv__note">{frame.note}</p>}
      {content.transcriptOrLog && (
        <div className="cctv__log">
          <p className="cctv__log-title">Operator log</p>
          <p>{content.transcriptOrLog}</p>
        </div>
      )}
    </div>
  );
}
