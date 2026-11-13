import { z } from 'zod';

const SuspectSchema = z
  .object({
    id: z.string().regex(/^s[1-6]$/),
    name: z.string().min(2).max(60),
    age: z.number().int().min(18).max(100),
    role: z.string().min(2).max(100),
    description: z.string().min(10).max(500),
    appearancePrompt: z.string().min(10).max(500),
    secret: z.string().min(5).max(500),
    alibi: z.string().min(5).max(500),
  })
  .strict();

const TruthSchema = z
  .object({
    culpritId: z.string().regex(/^s[1-6]$/),
    motive: z.string().min(10).max(700),
    method: z.string().min(10).max(700),
    timeline: z
      .array(z.object({ time: z.string().min(3).max(60), event: z.string().min(5).max(500) }).strict())
      .min(3)
      .max(12),
    explanation: z.string().min(30).max(2000),
  })
  .strict();

export const EVIDENCE_TYPES = ['chat', 'image', 'cctv', 'document', 'call_log', 'email'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

const ClueMapSchema = z
  .object({
    clueId: z.string().regex(/^c\d{1,2}$/),
    pointsTo: z
      .string()
      .regex(/^s[1-6]$/)
      .nullable(),
    kind: z.enum(['true_clue', 'red_herring', 'alibi', 'context']),
    evidenceType: z.enum(EVIDENCE_TYPES),
    description: z.string().min(10).max(500),
  })
  .strict();

export const BlueprintSchema = z
  .object({
    title: z.string().min(3).max(120),
    setting: z
      .object({
        location: z.string().min(2).max(120),
        date: z.string().min(4).max(60),
        timeframe: z.string().min(3).max(120),
      })
      .strict(),
    briefing: z.string().min(200).max(1600),
    suspects: z.array(SuspectSchema).min(4).max(6),
    truth: TruthSchema,
    clueMap: z.array(ClueMapSchema).min(8).max(14),
    hints: z.tuple([z.string().min(5).max(300), z.string().min(5).max(300), z.string().min(5).max(300)]),
  })
  .strict();

const ChatContentSchema = z
  .object({
    participants: z.array(z.string().min(1).max(80)).min(2).max(8),
    platform: z.literal('whatsapp'),
    messages: z
      .array(
        z
          .object({
            sender: z.string().min(1).max(80),
            text: z.string().min(1).max(500),
            timestamp: z.string().datetime({ offset: true }),
            status: z.enum(['sent', 'delivered', 'read']).optional(),
            deleted: z.boolean().optional(),
          })
          .strict(),
      )
      .min(8)
      .max(30),
  })
  .strict();
const ImageContentSchema = z
  .object({
    imagePrompt: z.string().min(12).max(700),
    caption: z.string().min(5).max(500),
    altText: z.string().min(5).max(300),
    metadata: z
      .object({ takenAt: z.string().optional(), location: z.string().optional(), device: z.string().optional() })
      .strict()
      .optional(),
  })
  .strict();
const CctvContentSchema = z
  .object({
    cameraId: z.string().min(2).max(40),
    location: z.string().min(2).max(120),
    frames: z
      .array(
        z
          .object({
            imagePrompt: z.string().min(12).max(700),
            timestamp: z.string().datetime({ offset: true }),
            note: z.string().max(300).optional(),
          })
          .strict(),
      )
      .min(3)
      .max(6),
    transcriptOrLog: z.string().max(1000).optional(),
  })
  .strict();
const DocumentContentSchema = z
  .object({
    docKind: z.enum(['receipt', 'note', 'report', 'ticket', 'bank_statement']),
    contentMarkdown: z.string().min(5).max(2000),
  })
  .strict();
const CallLogContentSchema = z
  .object({
    owner: z.string().min(2).max(80),
    entries: z
      .array(
        z
          .object({
            contact: z.string().min(1).max(80),
            direction: z.enum(['in', 'out', 'missed']),
            time: z.string().datetime({ offset: true }),
            durationSec: z.number().int().min(0).max(7200),
          })
          .strict(),
      )
      .min(2)
      .max(20),
  })
  .strict();
const EmailContentSchema = z
  .object({
    from: z.string().min(2).max(120),
    to: z.array(z.string().min(2).max(120)).min(1).max(10),
    subject: z.string().min(2).max(200),
    sentAt: z.string().datetime({ offset: true }),
    bodyText: z.string().min(5).max(2000),
  })
  .strict();

const EvidenceBase = {
  title: z.string().min(3).max(120),
  summary: z.string().min(10).max(300),
  occurredAt: z.string().datetime({ offset: true }),
  source: z.string().min(2).max(200),
};

export const EvidenceTextSchema = z.discriminatedUnion('type', [
  z.object({ ...EvidenceBase, type: z.literal('chat'), content: ChatContentSchema }).strict(),
  z.object({ ...EvidenceBase, type: z.literal('image'), content: ImageContentSchema }).strict(),
  z.object({ ...EvidenceBase, type: z.literal('cctv'), content: CctvContentSchema }).strict(),
  z.object({ ...EvidenceBase, type: z.literal('document'), content: DocumentContentSchema }).strict(),
  z.object({ ...EvidenceBase, type: z.literal('call_log'), content: CallLogContentSchema }).strict(),
  z.object({ ...EvidenceBase, type: z.literal('email'), content: EmailContentSchema }).strict(),
]);

export const ValidatorResultSchema = z
  .object({
    chosenSuspectId: z.string().regex(/^s[1-6]$/),
    supportingEvidenceIds: z
      .array(z.string().regex(/^e\d{1,2}$/))
      .min(2)
      .max(14),
    reasoning: z.string().min(10).max(1000),
  })
  .strict();

export const SafetyResultSchema = z
  .object({
    safe: z.boolean(),
    categories: z
      .array(
        z.enum([
          'sexual_content',
          'minors_in_danger',
          'real_person',
          'ongoing_crime',
          'graphic_gore',
          'hate_or_harassment',
          'actionable_crime',
          'none',
        ]),
      )
      .max(8),
    userMessage: z.string().max(300),
  })
  .strict();

export type Blueprint = z.infer<typeof BlueprintSchema>;
export type EvidenceText = z.infer<typeof EvidenceTextSchema>;
export type ValidatorResult = z.infer<typeof ValidatorResultSchema>;
export type SafetyResult = z.infer<typeof SafetyResultSchema>;

export const BlueprintJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    setting: {
      type: 'object',
      properties: { location: { type: 'string' }, date: { type: 'string' }, timeframe: { type: 'string' } },
      required: ['location', 'date', 'timeframe'],
    },
    briefing: { type: 'string' },
    suspects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          age: { type: 'integer' },
          role: { type: 'string' },
          description: { type: 'string' },
          appearancePrompt: { type: 'string' },
          secret: { type: 'string' },
          alibi: { type: 'string' },
        },
        required: ['id', 'name', 'age', 'role', 'description', 'appearancePrompt', 'secret', 'alibi'],
      },
    },
    truth: {
      type: 'object',
      properties: {
        culpritId: { type: 'string' },
        motive: { type: 'string' },
        method: { type: 'string' },
        timeline: {
          type: 'array',
          items: {
            type: 'object',
            properties: { time: { type: 'string' }, event: { type: 'string' } },
            required: ['time', 'event'],
          },
        },
        explanation: { type: 'string' },
      },
      required: ['culpritId', 'motive', 'method', 'timeline', 'explanation'],
    },
    clueMap: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          clueId: { type: 'string' },
          pointsTo: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          kind: { type: 'string', enum: ['true_clue', 'red_herring', 'alibi', 'context'] },
          evidenceType: { type: 'string', enum: [...EVIDENCE_TYPES] },
          description: { type: 'string' },
        },
        required: ['clueId', 'pointsTo', 'kind', 'evidenceType', 'description'],
      },
    },
    hints: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
  },
  required: ['title', 'setting', 'briefing', 'suspects', 'truth', 'clueMap', 'hints'],
};

export const EvidenceJsonSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['chat', 'image', 'cctv', 'document', 'call_log', 'email'] },
    title: { type: 'string' },
    summary: { type: 'string' },
    occurredAt: { type: 'string' },
    source: { type: 'string' },
    content: { type: 'object', additionalProperties: true },
  },
  required: ['type', 'title', 'summary', 'occurredAt', 'source', 'content'],
};

export const ValidatorJsonSchema = {
  type: 'object',
  properties: {
    chosenSuspectId: { type: 'string' },
    supportingEvidenceIds: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
  required: ['chosenSuspectId', 'supportingEvidenceIds', 'reasoning'],
};

export const SafetyJsonSchema = {
  type: 'object',
  properties: {
    safe: { type: 'boolean' },
    categories: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'sexual_content',
          'minors_in_danger',
          'real_person',
          'ongoing_crime',
          'graphic_gore',
          'hate_or_harassment',
          'actionable_crime',
          'none',
        ],
      },
    },
    userMessage: { type: 'string' },
  },
  required: ['safe', 'categories', 'userMessage'],
};

/** Several evidence items generated in one call so they share context (DEC-016). */
export const EvidenceBatchJsonSchema = {
  type: 'object',
  properties: { items: { type: 'array', items: EvidenceJsonSchema } },
  required: ['items'],
};

export const EvidenceBatchSchema = z.object({ items: z.array(EvidenceTextSchema).min(1).max(8) }).strict();
