import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildMockCase } from '../src/services/mockGeneration.service.js';

const modelState = vi.hoisted(() => ({
  updateOne: vi.fn(),
  delete: vi.fn(),
  caseDoc: { difficulty: 'easy', tone: 'classic_noir', seed: 'A portrait vanishes during a gallery opening.' },
}));

vi.mock('../src/db/models/Case.js', () => ({
  CaseModel: {
    findById: vi.fn(async () => modelState.caseDoc),
    updateOne: modelState.updateOne,
  },
}));

import { EVIDENCE_BATCH_SIZE, generateRealCase } from '../src/services/realCaseGeneration.service.js';
import { BlueprintJsonSchema, EvidenceBatchJsonSchema, ValidatorJsonSchema } from '../src/services/gemini/schemas.js';
import type { GeminiSession } from '../src/services/gemini/client.js';

function realFixture() {
  const sample = buildMockCase('easy', 'classic_noir', 'A portrait vanishes during a gallery opening.');
  const blueprint = {
    title: sample.title,
    setting: sample.setting,
    briefing: sample.briefing,
    suspects: sample.suspects.map(({ portraitPath, ...suspect }) => {
      void portraitPath;
      return suspect;
    }),
    truth: sample.hidden.truth,
    clueMap: sample.hidden.clueMap,
    hints: sample.hidden.hints,
  };
  const evidence = sample.evidence.map((item) => {
    const content = { ...item.content };
    delete content.imageUrl;
    if (item.type === 'image') content.imagePrompt = 'A framed painting beside a service cart';
    if (item.type === 'cctv' && Array.isArray(content.frames))
      content.frames = content.frames.map((frame) => {
        const updated = { ...(frame as Record<string, unknown>) };
        delete updated.imageUrl;
        updated.imagePrompt = 'A quiet fictional gallery corridor';
        return updated;
      });
    return {
      type: item.type,
      title: item.title,
      summary: item.summary,
      occurredAt: item.occurredAt,
      source: item.source,
      content,
    };
  });
  return { blueprint, evidence };
}

function makeSession(
  options: {
    wrongValidatorOnce?: boolean;
    wrongEvidenceTypeOnce?: boolean;
    failedImages?: number;
    failImagesOnCalls?: number[];
    imageError?: Error;
  } = {},
): GeminiSession {
  const { blueprint, evidence } = realFixture();
  let wrongTypePending = options.wrongEvidenceTypeOnce ?? false;
  let validatorCalls = 0;
  let failedImages = options.failedImages ?? 0;
  let imageCalls = 0;
  return {
    generateJson: vi.fn(async (input) => {
      if (input.jsonSchema === BlueprintJsonSchema) return blueprint;
      if (input.jsonSchema === EvidenceBatchJsonSchema) {
        const requests = input.prompt.user.split('EVIDENCE REQUESTS:')[1] ?? '';
        const ids = [...requests.matchAll(/"clueId":"c(\d+)"/g)].map((match) => Number(match[1]) - 1);
        const items = ids.map((index) => evidence[index]);
        if (wrongTypePending) {
          wrongTypePending = false;
          return { items: [items[2], items[1], items[0], ...items.slice(3)] };
        }
        return { items };
      }
      if (input.jsonSchema === ValidatorJsonSchema) {
        validatorCalls += 1;
        if (options.wrongValidatorOnce && validatorCalls === 1)
          return {
            chosenSuspectId: 's1',
            supportingEvidenceIds: ['e1', 'e2'],
            reasoning: 'The visible record points to a different person.',
          };
        return {
          chosenSuspectId: 's2',
          supportingEvidenceIds: ['e1', 'e2', 'e3'],
          reasoning: 'The chat, schedule and photograph support the same timeline.',
        };
      }
      throw new Error('Unexpected JSON schema request');
    }),
    generateImage: vi.fn(async () => {
      imageCalls += 1;
      if (options.failImagesOnCalls?.includes(imageCalls))
        throw options.imageError ?? new Error('Selected image unavailable');
      if (failedImages > 0) {
        failedImages -= 1;
        throw new Error('Image unavailable');
      }
      return { bytes: Buffer.from('generated-image'), mimeType: 'image/png' };
    }),
    usage: () => ({ textCalls: 0, inputTokens: 0, outputTokens: 0, images: 0, fallbacks: 0 }),
  };
}

const withImages = { generateImages: true };

const storage = {
  save: vi.fn(async () => `${randomUUID()}.png`),
  read: vi.fn(),
  delete: vi.fn(async () => undefined),
};

describe('real Gemini generation orchestration', () => {
  beforeEach(() => {
    modelState.updateOne.mockReset().mockResolvedValue({ modifiedCount: 1 });
    storage.save.mockClear();
    storage.delete.mockClear();
  });

  it('generates and publishes a validated case with private media paths', async () => {
    await generateRealCase('aaaaaaaaaaaaaaaaaaaaaaaa', makeSession(), storage, withImages);
    const readyUpdate = modelState.updateOne.mock.calls.find(([, update]) => update.$set?.status === 'ready');
    expect(readyUpdate).toBeDefined();
    expect(
      readyUpdate?.[1].$set?.suspects.every((suspect: { portraitPath: string }) =>
        /^[\da-f-]{36}\.png$/.test(suspect.portraitPath),
      ),
    ).toBe(true);
    expect(readyUpdate?.[1].$set?.hidden.validationReport.mode).toBe('gemini');
    expect(
      readyUpdate?.[1].$set?.evidence.some((item: { content: { imagePrompt?: string } }) => item.content.imagePrompt),
    ).toBe(false);
  });

  it('regenerates after a blind validator rejection', async () => {
    const session = makeSession({ wrongValidatorOnce: true });
    await generateRealCase('aaaaaaaaaaaaaaaaaaaaaaaa', session, storage, withImages);
    expect(session.generateJson).toHaveBeenCalled();
    expect(modelState.updateOne.mock.calls.some(([, update]) => update.$set?.generationAttempts === 2)).toBe(true);
    expect(storage.delete).toHaveBeenCalled();
  });

  it('keeps a case ready when image failures stay below thirty percent', async () => {
    const session = makeSession({ failImagesOnCalls: [5, 6] });
    await generateRealCase('aaaaaaaaaaaaaaaaaaaaaaaa', session, storage, withImages);
    const readyUpdate = modelState.updateOne.mock.calls.find(([, update]) => update.$set?.status === 'ready');
    expect(
      readyUpdate?.[1].$set?.evidence.some((item: { mediaStatus: string }) => item.mediaStatus === 'placeholder'),
    ).toBe(true);
  });

  it('fails generation if more than thirty percent of media is unavailable', async () => {
    await expect(
      generateRealCase('aaaaaaaaaaaaaaaaaaaaaaaa', makeSession({ failedImages: 20 }), storage, withImages),
    ).rejects.toThrow('Too many generated media items failed');
    expect(modelState.updateOne.mock.calls.some(([, update]) => update.$set?.status === 'ready')).toBe(false);
  });

  it('stops scheduling images after Gemini reports exhausted quota', async () => {
    const quotaError = Object.assign(
      new Error(
        JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Daily quota exceeded.' } }),
      ),
      { status: 429 },
    );
    const session = makeSession({ failImagesOnCalls: [1], imageError: quotaError });

    await expect(generateRealCase('aaaaaaaaaaaaaaaaaaaaaaaa', session, storage, withImages)).rejects.toBe(quotaError);

    expect(session.generateImage).toHaveBeenCalledTimes(3);
    expect(modelState.updateOne.mock.calls.some(([, update]) => update.$set?.status === 'ready')).toBe(false);
  });

  it('uses placeholders and makes no image calls when image generation is disabled', async () => {
    const session = makeSession();
    await generateRealCase('aaaaaaaaaaaaaaaaaaaaaaaa', session, storage, { generateImages: false });
    expect(session.generateImage).not.toHaveBeenCalled();
    const ready = modelState.updateOne.mock.calls.find(([, update]) => update.$set?.status === 'ready')?.[1].$set;
    expect(ready.hidden.validationReport.media).toBe('disabled');
    expect(ready.suspects.every((suspect: { portraitPath: string }) => suspect.portraitPath.endsWith('.svg'))).toBe(
      true,
    );
    const visual = ready.evidence.filter((item: { type: string }) => item.type === 'image' || item.type === 'cctv');
    expect(visual.every((item: { mediaStatus: string }) => item.mediaStatus === 'placeholder')).toBe(true);
    expect(JSON.stringify(ready.evidence)).not.toContain('imagePrompt');
  });

  it('generates evidence in batches instead of one call per item', async () => {
    const session = makeSession();
    await generateRealCase('aaaaaaaaaaaaaaaaaaaaaaaa', session, storage, { generateImages: false });
    const evidenceCalls = vi
      .mocked(session.generateJson)
      .mock.calls.filter(([input]) => input.jsonSchema === EvidenceBatchJsonSchema);
    expect(evidenceCalls).toHaveLength(Math.ceil(8 / EVIDENCE_BATCH_SIZE));
    expect(evidenceCalls[0][0].prompt.user).toContain('hiddenTruth');
  });

  it('asks again when a batch returns the wrong evidence type, keeping the same blueprint', async () => {
    const session = makeSession({ wrongEvidenceTypeOnce: true });
    await generateRealCase('aaaaaaaaaaaaaaaaaaaaaaaa', session, storage, { generateImages: false });
    const calls = vi.mocked(session.generateJson).mock.calls.map(([input]) => input);
    expect(calls.filter((input) => input.jsonSchema === BlueprintJsonSchema)).toHaveLength(1);
    const retried = calls.filter((input) => input.jsonSchema === EvidenceBatchJsonSchema)[2];
    expect(retried.prompt.user).toContain('must have type');
    expect(modelState.updateOne.mock.calls.some(([, update]) => update.$set?.status === 'ready')).toBe(true);
  });
});

describe('case timestamp normalisation (DEC-018)', () => {
  it('keeps the wall-clock time and rewrites every offset to +00:00, deeply', async () => {
    const { normalizeCaseTimestamps } = await import('../src/services/realCaseGeneration.service.js');
    const result = normalizeCaseTimestamps({
      occurredAt: '2024-10-15T21:48:00+02:00',
      content: {
        messages: [{ timestamp: '2024-10-15T22:05:00-04:00' }, { timestamp: '2024-10-15T22:06:00.500Z' }],
        caption: 'Taken at 2024-10-15T21:00:00-04:00 by the lobby camera',
      },
    });
    expect(result.occurredAt).toBe('2024-10-15T21:48:00+00:00');
    expect(result.content.messages[0].timestamp).toBe('2024-10-15T22:05:00+00:00');
    expect(result.content.messages[1].timestamp).toBe('2024-10-15T22:06:00.500+00:00');
    expect(result.content.caption).toContain('-04:00');
  });
});
