/**
 * Evidence timestamps are case-local wall-clock times stored with +00:00 (DEC-018).
 * Formatting in UTC shows the story's clock time regardless of the player's time zone.
 */
const caseZone = { timeZone: 'UTC' } as const;

function parse(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function caseTime(value?: string): string {
  const date = parse(value);
  return date ? new Intl.DateTimeFormat('en-GB', { ...caseZone, hour: '2-digit', minute: '2-digit' }).format(date) : '';
}

export function caseTimeWithSeconds(value?: string): string {
  const date = parse(value);
  return date
    ? new Intl.DateTimeFormat('en-GB', { ...caseZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        date,
      )
    : '';
}

export function caseDate(value?: string): string {
  const date = parse(value);
  return date
    ? new Intl.DateTimeFormat('en-GB', { ...caseZone, day: 'numeric', month: 'long', year: 'numeric' }).format(date)
    : '';
}

export function caseDateShort(value?: string): string {
  const date = parse(value);
  return date
    ? new Intl.DateTimeFormat('en-GB', { ...caseZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
    : '';
}

/** Day key used to insert date separators in chats. */
export function caseDayKey(value?: string): string {
  return value?.slice(0, 10) ?? '';
}

export function duration(seconds: number): string {
  if (seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

export function elapsed(fromIso: string, now = Date.now()): string {
  const start = parse(fromIso);
  if (!start) return '0:00';
  const total = Math.max(0, Math.floor((now - start.getTime()) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(hours ? 2 : 1, '0');
  return `${hours ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

export const difficultyLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;
export const toneLabel = {
  classic_noir: 'Classic noir',
  modern_thriller: 'Modern thriller',
  cozy: 'Cozy',
  corporate: 'Corporate',
} as const;
