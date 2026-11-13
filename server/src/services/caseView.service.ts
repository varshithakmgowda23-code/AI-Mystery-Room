import type {
  CaseSolution,
  ClueRole,
  PlayerCaseView,
  PlayerEvidence,
  PlayerSuspect,
  SuspectTag,
} from '@ai-mystery-room/shared';

/**
 * DTO mappers: the ONLY way controllers turn a stored case into a client response (spec §13.2, §15.1).
 * Every field is copied from an explicit whitelist, so hidden data (truth, clue map, clue roles,
 * suspect secrets, image prompts, validation report, unrevealed hints) can never leak by accident.
 */

type StoredSuspect = {
  id: string;
  name: string;
  age: number;
  role: string;
  description: string;
  alibi: string;
  portraitPath?: string | null;
};
type StoredEvidence = {
  id: string;
  type: PlayerEvidence['type'];
  title: string;
  summary: string;
  occurredAt: string;
  source: string;
  mediaStatus?: 'ok' | 'placeholder' | null;
  content: unknown;
  clueId?: string | null;
  pointsTo?: string | null;
  kind?: string | null;
};
type StoredHidden = {
  truth?: {
    culpritId: string;
    motive: string;
    method: string;
    timeline: Array<{ time: string; event: string }>;
    explanation: string;
  };
  clueMap?: Array<{ clueId: string; pointsTo: string | null; kind: ClueRole; description: string }>;
  hints?: string[];
};

export type StoredCase = {
  _id: unknown;
  title?: string | null;
  difficulty: PlayerCaseView['difficulty'];
  tone: PlayerCaseView['tone'];
  status: PlayerCaseView['status'];
  setting?: { location?: string | null; date?: string | null; timeframe?: string | null } | null;
  briefing?: string | null;
  suspects?: StoredSuspect[];
  evidence?: StoredEvidence[];
  hidden?: StoredHidden | null;
  state?: {
    viewedEvidence?: string[];
    hintsUsed?: number;
    attemptsUsed?: number;
    maxAttempts?: number;
    accusations?: Array<{ suspectId: string; reasoning?: string | null; at: Date | string; correct: boolean }>;
    notes?: string;
    suspectTags?: Map<string, string> | Record<string, string>;
    startedAt?: Date | string;
    resolvedAt?: Date | string | null;
  } | null;
  result?: { score: number; correct: boolean; culpritId: string; gaveUp?: boolean | null } | null;
  createdAt?: Date | string;
};

export const HINTS_PER_CASE = 3;

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : undefined);

function pick<T extends Record<string, unknown>>(source: unknown, keys: readonly string[]): T {
  const record = (typeof source === 'object' && source !== null ? source : {}) as Record<string, unknown>;
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])) as T;
}

/** Player-visible content per evidence type (spec §10). Image prompts are never included. */
function visibleContent(type: PlayerEvidence['type'], content: unknown): PlayerEvidence['content'] {
  const record = (typeof content === 'object' && content !== null ? content : {}) as Record<string, unknown>;
  switch (type) {
    case 'chat':
      return {
        participants: (record.participants as string[]) ?? [],
        platform: 'whatsapp',
        messages: ((record.messages as unknown[]) ?? []).map((message) =>
          pick(message, ['sender', 'text', 'timestamp', 'status', 'deleted']),
        ),
      } as PlayerEvidence['content'];
    case 'image':
      return {
        ...pick(record, ['imageUrl', 'caption', 'altText']),
        ...(record.metadata ? { metadata: pick(record.metadata, ['takenAt', 'location', 'device']) } : {}),
      } as PlayerEvidence['content'];
    case 'cctv':
      return {
        ...pick(record, ['cameraId', 'location', 'transcriptOrLog']),
        frames: ((record.frames as unknown[]) ?? []).map((frame) => pick(frame, ['imageUrl', 'timestamp', 'note'])),
      } as PlayerEvidence['content'];
    case 'document':
      return pick(record, ['docKind', 'contentMarkdown']) as PlayerEvidence['content'];
    case 'call_log':
      return {
        owner: record.owner,
        entries: ((record.entries as unknown[]) ?? []).map((entry) =>
          pick(entry, ['contact', 'direction', 'time', 'durationSec']),
        ),
      } as PlayerEvidence['content'];
    case 'email':
      return pick(record, ['from', 'to', 'subject', 'sentAt', 'bodyText']) as PlayerEvidence['content'];
  }
}

function tagsOf(value: Map<string, string> | Record<string, string> | undefined): Record<string, SuspectTag> {
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value ?? {});
  return Object.fromEntries(
    entries.filter(([, tag]) => tag === 'suspicious' || tag === 'cleared' || tag === 'unknown'),
  ) as Record<string, SuspectTag>;
}

export function toPlayerView(doc: StoredCase): PlayerCaseView {
  const state = doc.state ?? {};
  const viewed = new Set(state.viewedEvidence ?? []);
  const hintsUsed = Math.min(state.hintsUsed ?? 0, HINTS_PER_CASE);
  const maxAttempts = state.maxAttempts ?? 2;
  const suspects: PlayerSuspect[] = (doc.suspects ?? []).map((suspect) => ({
    id: suspect.id,
    name: suspect.name,
    age: suspect.age,
    role: suspect.role,
    description: suspect.description,
    alibi: suspect.alibi,
    portraitUrl: suspect.portraitPath ?? '',
  }));
  const evidence = (doc.evidence ?? []).map(
    (item) =>
      ({
        id: item.id,
        type: item.type,
        title: item.title,
        summary: item.summary,
        occurredAt: item.occurredAt,
        source: item.source,
        ...(item.mediaStatus ? { mediaStatus: item.mediaStatus } : {}),
        viewed: viewed.has(item.id),
        content: visibleContent(item.type, item.content),
      }) as PlayerEvidence,
  );
  return {
    id: String(doc._id),
    title: doc.title ?? 'Untitled case',
    difficulty: doc.difficulty,
    tone: doc.tone,
    status: doc.status,
    setting: {
      location: doc.setting?.location ?? '',
      date: doc.setting?.date ?? '',
      timeframe: doc.setting?.timeframe ?? '',
    },
    briefing: doc.briefing ?? '',
    suspects,
    evidence,
    hintsUsed,
    hintsAvailable: HINTS_PER_CASE,
    // Only hints the player has already paid for (FR-20).
    revealedHints: (doc.hidden?.hints ?? []).slice(0, hintsUsed),
    attemptsRemaining: Math.max(0, maxAttempts - (state.attemptsUsed ?? 0)),
    maxAttempts,
    accusations: (state.accusations ?? []).map((accusation) => ({
      suspectId: accusation.suspectId,
      ...(accusation.reasoning ? { reasoning: accusation.reasoning } : {}),
      at: iso(accusation.at) ?? '',
      correct: accusation.correct,
    })),
    notes: state.notes ?? '',
    suspectTags: tagsOf(state.suspectTags),
    startedAt: iso(state.startedAt) ?? iso(doc.createdAt) ?? new Date(0).toISOString(),
    ...(state.resolvedAt ? { resolvedAt: iso(state.resolvedAt) } : {}),
    createdAt: iso(doc.createdAt) ?? new Date(0).toISOString(),
  };
}

/** Full solution: only for resolved cases (FR-23, FR-25). */
export function toResolvedView(doc: StoredCase): PlayerCaseView {
  const view = toPlayerView(doc);
  if (doc.status !== 'resolved' || !doc.hidden?.truth) return view;
  const truth = doc.hidden.truth;
  const clueById = new Map((doc.hidden.clueMap ?? []).map((clue) => [clue.clueId, clue]));
  const solution: CaseSolution = {
    culpritId: truth.culpritId,
    motive: truth.motive,
    method: truth.method,
    timeline: truth.timeline.map(({ time, event }) => ({ time, event })),
    explanation: truth.explanation,
    clueBreakdown: (doc.evidence ?? []).map((item) => {
      const clue = item.clueId ? clueById.get(item.clueId) : undefined;
      return {
        evidenceId: item.id,
        role: (clue?.kind ?? item.kind ?? 'context') as ClueRole,
        pointsTo: clue?.pointsTo ?? item.pointsTo ?? null,
        explanation: clue?.description ?? '',
      };
    }),
  };
  return {
    ...view,
    revealedHints: doc.hidden.hints ?? view.revealedHints,
    solution,
    ...(doc.result
      ? {
          result: {
            score: doc.result.score,
            correct: doc.result.correct,
            culpritId: doc.result.culpritId,
            gaveUp: Boolean(doc.result.gaveUp),
          },
        }
      : {}),
  };
}
