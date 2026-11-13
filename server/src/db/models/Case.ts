import { model, Schema, type InferSchemaType } from 'mongoose';

const settingSchema = new Schema({ location: String, date: String, timeframe: String }, { _id: false });
const suspectSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  age: { type: Number, required: true },
  role: { type: String, required: true },
  description: { type: String, required: true },
  appearancePrompt: { type: String, select: false },
  secret: { type: String, select: false },
  portraitPath: { type: String },
  alibi: { type: String, required: true },
}, { _id: false });
const evidenceSchema = new Schema({
  id: { type: String, required: true },
  type: { type: String, enum: ['chat', 'image', 'cctv', 'document', 'call_log', 'email'], required: true },
  title: { type: String, required: true },
  summary: { type: String, required: true },
  occurredAt: { type: String, required: true },
  source: { type: String, required: true },
  mediaStatus: { type: String, enum: ['ok', 'placeholder'] },
  content: { type: Schema.Types.Mixed, required: true },
  clueId: { type: String, select: false },
  pointsTo: { type: String, select: false },
  kind: { type: String, select: false },
}, { _id: false });
const truthSchema = new Schema({
  culpritId: { type: String, required: true },
  motive: { type: String, required: true },
  method: { type: String, required: true },
  timeline: { type: [Schema.Types.Mixed], required: true },
  explanation: { type: String, required: true },
}, { _id: false });
const hiddenSchema = new Schema({
  truth: { type: truthSchema, required: true },
  clueMap: { type: [Schema.Types.Mixed], required: true },
  hints: { type: [String], required: true },
  validationReport: { type: Schema.Types.Mixed },
}, { _id: false, select: false });
const accusationSchema = new Schema({
  suspectId: { type: String, required: true },
  reasoning: { type: String, maxlength: 500 },
  at: { type: Date, required: true },
  correct: { type: Boolean, required: true },
}, { _id: false });
const stateSchema = new Schema({
  viewedEvidence: { type: [String], default: [] },
  hintsUsed: { type: Number, default: 0 },
  attemptsUsed: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 2 },
  accusations: { type: [accusationSchema], default: [] },
  notes: { type: String, default: '' },
  suspectTags: { type: Map, of: String, default: {} },
  startedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date },
}, { _id: false });

const caseSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  seed: { type: String, required: true, maxlength: 500 },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], required: true },
  tone: { type: String, enum: ['classic_noir', 'modern_thriller', 'cozy', 'corporate'], required: true },
  status: { type: String, enum: ['queued', 'generating', 'ready', 'in_progress', 'resolved', 'failed'], required: true, default: 'queued', index: true },
  progress: { stage: { type: String, default: 'queued' }, percent: { type: Number, default: 0 } },
  failureReason: { type: String },
  failureCode: { type: String },
  failureRetryAt: { type: Date },
  generationAttempts: { type: Number, default: 0 },
  promptVersion: { type: String, default: '1.0.0' },
  title: { type: String },
  setting: { type: settingSchema },
  briefing: { type: String },
  suspects: { type: [suspectSchema], default: [] },
  evidence: { type: [evidenceSchema], default: [] },
  hidden: { type: hiddenSchema, select: false },
  state: { type: stateSchema, default: () => ({}) },
  expiresAt: { type: Date },
}, { timestamps: true });

caseSchema.index({ userId: 1, createdAt: -1 });
caseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $exists: true } } });

export type CaseRecord = InferSchemaType<typeof caseSchema>;
export const CaseModel = model('Case', caseSchema);
