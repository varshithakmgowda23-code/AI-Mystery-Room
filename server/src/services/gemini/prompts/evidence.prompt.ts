import type { Difficulty, Tone } from '@ai-mystery-room/shared';
import type { Blueprint } from '../schemas.js';
import { FAIRNESS_SAFETY_CONTRACT } from './shared.js';

type Clue = Blueprint['clueMap'][number];

const CONTENT_SHAPES = `Content shape by type:
- chat: {participants: string[], platform: "whatsapp", messages: AT LEAST 8 and at most 30 (count them; fewer than 8 is rejected) of {sender, text, timestamp (ISO 8601 ending in +00:00), status?: "sent"|"delivered"|"read", deleted?: boolean}}. Informal, realistic texting. A deleted message has deleted=true and text "This message was deleted".
- image: {imagePrompt, caption, altText, metadata?: {takenAt?, location?, device?}}. The caption and altText must describe everything a detective needs to see, because players may only see the text.
- cctv: {cameraId, location, frames: 3-6 of {imagePrompt, timestamp (ISO 8601 ending in +00:00), note?}, transcriptOrLog?}. Notes and the log describe what is visible in each frame.
- document: {docKind: "receipt"|"note"|"report"|"ticket"|"bank_statement", contentMarkdown}. Plain markdown, no HTML.
- call_log: {owner, entries: 2-20 of {contact, direction: "in"|"out"|"missed", time (ISO 8601 ending in +00:00), durationSec}}.
- email: {from, to: string[], subject, sentAt (ISO 8601 ending in +00:00), bodyText}.
Image prompts end with "realistic, natural lighting, no visible text, no faces of real people". CCTV prompts end with "low-resolution security camera frame, wide angle, grainy".`;

/**
 * Builds one prompt for several evidence items. Each call sees the whole hidden plan so
 * times, places and names stay consistent across items (fairness rule 5).
 */
export function buildEvidenceBatchPrompt(
  blueprint: Blueprint,
  batch: Clue[],
  difficulty: Difficulty,
  tone: Tone,
  validationError?: string,
) {
  const caseFile = {
    title: blueprint.title,
    setting: blueprint.setting,
    briefing: blueprint.briefing,
    suspects: blueprint.suspects.map(({ id, name, age, role, description, alibi, secret }) => ({
      id,
      name,
      age,
      role,
      description,
      alibi,
      secret,
    })),
    hiddenTruth: blueprint.truth,
    fullCluePlan: blueprint.clueMap,
  };
  const requests = batch.map((clue, index) => ({
    position: index + 1,
    clueId: clue.clueId,
    requiredType: clue.evidenceType,
    role: clue.kind,
    target: clue.pointsTo,
    description: clue.description,
  }));
  return {
    system: `You write player-visible fictional case evidence for a detective game. Return JSON {"items": [...]} with exactly one item per request, in the same order. Each item has type (must equal requiredType), title, summary (one sentence teaser), occurredAt (ISO 8601 ending in +00:00, on the case date and consistent with the hidden timeline), source (where the evidence came from), and content.

${CONTENT_SHAPES}

Rules:
- Every timestamp is the case's local clock time written with the +00:00 suffix (e.g. ${blueprint.setting.date}T21:41:00+00:00). Never use other offsets.
- You know the hidden truth so every detail is consistent. Never reveal it directly: no confessions, no "the culprit is", no naming who did it.
- A true_clue lets a careful player connect the target suspect to the crime through a detail (time, place, object, contradiction). Difficulty ${difficulty}: ${difficulty === 'easy' ? 'make the detail fairly direct' : difficulty === 'medium' ? 'the detail should need cross-referencing with another item' : 'make the detail subtle (timestamps, metadata, deleted messages)'}.
- A red_herring looks suspicious for its target but has an ordinary explanation found in the hidden truth or secrets.
- An alibi item gives verifiable proof of where its target was during the crime.
- Use only names, places and times from the case file.

${FAIRNESS_SAFETY_CONTRACT}`,
    user: `Difficulty=${difficulty}; tone=${tone}.
CASE FILE (hidden, for consistency only):
${JSON.stringify(caseFile).slice(0, 16_000)}

EVIDENCE REQUESTS:
${JSON.stringify(requests)}
${validationError ? `\nYour previous response failed validation: ${validationError}. Correct those issues.` : ''}
Return only the JSON object.`,
  };
}
