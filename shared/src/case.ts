import { z } from 'zod';
import type { CaseStatus, Difficulty, Tone } from './schemas.js';

/** Player-visible evidence content shapes (spec §10). Hidden fields never appear here. */
export type ChatContent = {
  participants: string[];
  platform: 'whatsapp';
  messages: Array<{
    sender: string;
    text: string;
    timestamp: string;
    status?: 'sent' | 'delivered' | 'read';
    deleted?: boolean;
  }>;
};
export type ImageContent = {
  imageUrl: string;
  caption: string;
  altText: string;
  metadata?: { takenAt?: string; location?: string; device?: string };
};
export type CctvContent = {
  cameraId: string;
  location: string;
  frames: Array<{ imageUrl: string; timestamp: string; note?: string }>;
  transcriptOrLog?: string;
};
export type DocumentContent = {
  docKind: 'receipt' | 'note' | 'report' | 'ticket' | 'bank_statement';
  contentMarkdown: string;
};
export type CallLogContent = {
  owner: string;
  entries: Array<{ contact: string; direction: 'in' | 'out' | 'missed'; time: string; durationSec: number }>;
};
export type EmailContent = { from: string; to: string[]; subject: string; sentAt: string; bodyText: string };

type EvidenceBase = {
  id: string;
  title: string;
  summary: string;
  occurredAt: string;
  source: string;
  mediaStatus?: 'ok' | 'placeholder';
  viewed: boolean;
};

export type PlayerEvidence =
  | (EvidenceBase & { type: 'chat'; content: ChatContent })
  | (EvidenceBase & { type: 'image'; content: ImageContent })
  | (EvidenceBase & { type: 'cctv'; content: CctvContent })
  | (EvidenceBase & { type: 'document'; content: DocumentContent })
  | (EvidenceBase & { type: 'call_log'; content: CallLogContent })
  | (EvidenceBase & { type: 'email'; content: EmailContent });

export type EvidenceType = PlayerEvidence['type'];

export type PlayerSuspect = {
  id: string;
  name: string;
  age: number;
  role: string;
  description: string;
  alibi: string;
  portraitUrl: string;
};

export const SuspectTagSchema = z.enum(['unknown', 'suspicious', 'cleared']);
export type SuspectTag = z.infer<typeof SuspectTagSchema>;

export type ClueRole = 'true_clue' | 'red_herring' | 'alibi' | 'context';

/** Only present once a case is resolved (spec §15.1). */
export type CaseSolution = {
  culpritId: string;
  motive: string;
  method: string;
  timeline: Array<{ time: string; event: string }>;
  explanation: string;
  clueBreakdown: Array<{ evidenceId: string; role: ClueRole; pointsTo: string | null; explanation: string }>;
};

export type CaseResult = { score: number; correct: boolean; culpritId: string; gaveUp: boolean };

export type Accusation = { suspectId: string; reasoning?: string; at: string; correct: boolean };

/** GET /api/cases/:id (API-10). */
export type PlayerCaseView = {
  id: string;
  title: string;
  difficulty: Difficulty;
  tone: Tone;
  status: CaseStatus;
  setting: { location: string; date: string; timeframe: string };
  briefing: string;
  suspects: PlayerSuspect[];
  evidence: PlayerEvidence[];
  hintsUsed: number;
  hintsAvailable: number;
  revealedHints: string[];
  attemptsRemaining: number;
  maxAttempts: number;
  accusations: Accusation[];
  notes: string;
  suspectTags: Record<string, SuspectTag>;
  startedAt: string;
  resolvedAt?: string;
  createdAt: string;
  /** Resolved cases only. */
  solution?: CaseSolution;
  result?: CaseResult;
};

export const NotesSchema = z.object({ notes: z.string().max(10_000) }).strict();
export const SuspectTagsSchema = z.object({ tags: z.record(z.string().regex(/^s[1-6]$/), SuspectTagSchema) }).strict();
export const EvidenceIdSchema = z.string().regex(/^e\d{1,2}$/);
