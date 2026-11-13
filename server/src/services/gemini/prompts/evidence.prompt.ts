import type { Difficulty, Tone } from '@ai-mystery-room/shared';
import type { Blueprint } from '../schemas.js';
import { FAIRNESS_SAFETY_CONTRACT } from './shared.js';

export function buildEvidencePrompt(blueprint: Blueprint, clue: Blueprint['clueMap'][number], difficulty: Difficulty, tone: Tone) {
  const target = clue.pointsTo ? blueprint.suspects.find((suspect) => suspect.id === clue.pointsTo) : undefined;
  return {
    system: `You create one player-visible piece of fictional case evidence and return JSON with type, title, summary, occurredAt (ISO timestamp), source, and type-specific content. Allowed types: chat, image, cctv, document, call_log, email. Chat content: participants, platform=whatsapp, 8–30 messages with sender/text/timestamp. Image content: imagePrompt, caption, altText, optional metadata. CCTV content: cameraId, location, 3–6 frames each with imagePrompt, timestamp and optional note, optional transcriptOrLog. Document content: docKind and contentMarkdown. Call log content: owner and entries. Email content: from, to, subject, sentAt, bodyText. Use the requested clue role faithfully without naming the culprit outright. Image prompts end with: "realistic, natural lighting, no visible text, no faces of real people"; CCTV prompts end with: "low-resolution security camera frame, wide angle, grainy". ${FAIRNESS_SAFETY_CONTRACT}`,
    user: `Create evidence for clue ${clue.clueId}. Difficulty=${difficulty}; tone=${tone}. Planned role=${clue.kind}; target=${target ? `${target.id} (${target.name})` : 'neutral'}. Clue description: ${clue.description}. Use this case setting and cast: ${JSON.stringify({ title: blueprint.title, setting: blueprint.setting, suspects: blueprint.suspects.map(({ id, name, role, alibi }) => ({ id, name, role, alibi })) }).slice(0, 7000)}. The culprit is ${blueprint.truth.culpritId}, but never state or confess this in player-visible content. Return only the JSON object.` ,
  };
}
