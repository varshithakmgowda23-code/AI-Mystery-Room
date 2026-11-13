import type { EvidenceType } from '@ai-mystery-room/shared';

const paths = {
  chat: 'M4 5h16v11H8l-4 4V5z',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15.5 8.5h.01',
  cctv: 'M3 7l13-3 2 6-13 3zM6 12l1 4h4M18 10l3 1',
  document: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7',
  call_log: 'M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z',
  email: 'M3 6h18v12H3zM3 7l9 6 9-6',
  incoming: 'M18 6L6 18M6 9v9h9',
  outgoing: 'M6 18L18 6M9 6h9v9',
  missed: 'M5 8l7 7 7-7M14 8h5v5',
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  prev: 'M18 6l-8 6 8 6zM6 6v12',
  next: 'M6 6l8 6-8 6zM18 6v12',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  zoom: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M11 8v6M8 11h6',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 3z',
  check: 'M5 12l5 5 9-10',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 1112 0c0 5.5-6 11-6 11zM12 8a2 2 0 100 4 2 2 0 000-4z',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  deleted: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export const evidenceTypeLabel: Record<EvidenceType, string> = {
  chat: 'Chat',
  image: 'Photo',
  cctv: 'CCTV',
  document: 'Document',
  call_log: 'Call log',
  email: 'Email',
};
