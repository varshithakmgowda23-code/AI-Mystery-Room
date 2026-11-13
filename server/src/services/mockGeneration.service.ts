import type { Difficulty, Tone } from '@ai-mystery-room/shared';

export type ClueKind = 'true_clue' | 'red_herring' | 'alibi' | 'context';
export interface MockEvidence {
  id: string;
  type: 'chat' | 'image' | 'cctv' | 'document' | 'call_log' | 'email';
  title: string;
  summary: string;
  occurredAt: string;
  source: string;
  mediaStatus?: 'ok' | 'placeholder';
  content: Record<string, unknown>;
  clueId: string;
  pointsTo: string | null;
  kind: ClueKind;
}

export interface MockCaseContent {
  title: string;
  setting: { location: string; date: string; timeframe: string };
  briefing: string;
  suspects: Array<Record<string, unknown>>;
  evidence: MockEvidence[];
  hidden: {
    truth: {
      culpritId: string;
      motive: string;
      method: string;
      timeline: Array<{ time: string; event: string }>;
      explanation: string;
    };
    clueMap: Array<{ clueId: string; pointsTo: string | null; kind: ClueKind; description: string }>;
    hints: [string, string, string];
    validationReport: { mode: 'mock'; passed: true; checkedAt: string; supportingClues: string[] };
  };
}

const suspectNames = ['Mara Ellis', 'Theo Venn', 'Iris Calder', 'Jonah Reed', 'Nina Sol', 'Felix Ward'];
const suspectRoles = [
  'Gallery curator',
  'Restoration specialist',
  'Event coordinator',
  'Security supervisor',
  'Photographer',
  'Donor liaison',
];
const culpritId = 's2';
const placeholderImage = '/media/evidence-placeholder.svg';

export function buildMockCase(difficulty: Difficulty, tone: Tone, seed: string): MockCaseContent {
  const suspectCount = difficulty === 'easy' ? 4 : difficulty === 'medium' ? 5 : 6;
  const evidenceCount = difficulty === 'easy' ? 8 : difficulty === 'medium' ? 11 : 14;
  const trueCount = difficulty === 'hard' ? 4 : 3;
  const redHerringCount = difficulty === 'hard' ? 3 : 2;
  const suspects = Array.from({ length: suspectCount }, (_, index) => {
    const id = `s${index + 1}`;
    const name = suspectNames[index];
    return {
      id,
      name,
      age: 31 + index * 4,
      role: suspectRoles[index],
      description: `${name} is the ${suspectRoles[index].toLowerCase()} at the fictional Bellweather Gallery.`,
      appearancePrompt: `Stylized editorial portrait of a fictional ${suspectRoles[index].toLowerCase()}, ink and warm sepia, no photorealism.`,
      secret:
        id === culpritId
          ? 'Theo moved the painting to hide a forged provenance record.'
          : 'They concealed a harmless personal embarrassment.',
      portraitPath: '/media/portrait-placeholder.svg',
      alibi:
        id === culpritId
          ? 'Says they were checking the east display room.'
          : `Was accounted for in the ${['archive', 'foyer', 'coat room', 'loading bay', 'library'][index % 5]} during the key interval.`,
    };
  });

  const types: MockEvidence['type'][] = ['chat', 'chat', 'image', 'image', 'cctv', 'document', 'call_log', 'email'];
  const extraTypes: MockEvidence['type'][] = ['document', 'chat', 'call_log', 'email', 'document', 'cctv'];
  while (types.length < evidenceCount) types.push(extraTypes[types.length % extraTypes.length]);
  const evidence = types.slice(0, evidenceCount).map((type, index): MockEvidence => {
    const id = `e${index + 1}`;
    const clueId = `c${index + 1}`;
    let kind: ClueKind = 'context';
    let pointsTo: string | null = null;
    if (index < trueCount) {
      kind = 'true_clue';
      pointsTo = culpritId;
    } else if (index < trueCount + redHerringCount) {
      kind = 'red_herring';
      const innocentIds = suspects.filter((suspect) => suspect.id !== culpritId).map((suspect) => String(suspect.id));
      pointsTo = innocentIds[(index - trueCount) % innocentIds.length];
    } else if (index - trueCount - redHerringCount < suspectCount - 1) {
      kind = 'alibi';
      const innocentIds = suspects.filter((suspect) => suspect.id !== culpritId).map((suspect) => String(suspect.id));
      pointsTo = innocentIds[(index - trueCount - redHerringCount) % innocentIds.length];
    }

    const occurredAt = new Date(Date.UTC(2025, 3, 18, 19 + Math.floor(index / 3), (index * 11) % 60)).toISOString();
    const common = {
      id,
      type,
      occurredAt,
      source: type === 'chat' ? 'Recovered from the event planning group chat' : 'Bellweather Gallery case archive',
      clueId,
      pointsTo,
      kind,
    };
    const trueSummary =
      index === 0
        ? 'A message places the restoration cart by the east room just before the alarm.'
        : index === 1
          ? 'A second message conflicts with the restorer’s account of where they were.'
          : index === 3
            ? 'A second photograph records the same cart turned toward the service corridor.'
            : 'A service note ties the moved frame to the restoration cart.';
    const summary =
      kind === 'true_clue'
        ? trueSummary
        : kind === 'red_herring'
          ? 'A detail looks suspicious until it is compared with the event schedule.'
          : kind === 'alibi'
            ? 'A routine record helps place one guest away from the gallery.'
            : 'A timestamp adds context to the evening’s sequence.';
    let title = `Evidence ${index + 1}`;
    let content: Record<string, unknown>;
    let mediaStatus: MockEvidence['mediaStatus'];
    if (type === 'chat') {
      title = index === 0 ? 'Planning chat: Mara & Theo' : 'Event group chat';
      content = {
        participants: ['Mara Ellis', 'Theo Venn'],
        platform: 'whatsapp',
        messages: Array.from({ length: 8 }, (_, messageIndex) => ({
          sender: messageIndex % 2 === 0 ? 'Mara Ellis' : 'Theo Venn',
          text:
            messageIndex === 3 && index === 0
              ? 'I will check the east room before the doors open.'
              : messageIndex === 3 && index === 1
                ? 'I never went near the east room; I stayed in the foyer until 8:20.'
                : ['The labels are ready.', 'I left the cart by the service door.', 'See you after the toast.'][
                    messageIndex % 3
                  ],
          timestamp: new Date(Date.parse(occurredAt) + messageIndex * 60_000).toISOString(),
          status: 'read',
        })),
      };
    } else if (type === 'image') {
      title = index === 2 ? 'Service corridor photograph' : 'Gallery floor photograph';
      mediaStatus = 'placeholder';
      content = {
        imageUrl: placeholderImage,
        caption:
          index === 2
            ? 'A restoration cart bearing a small TV tool tag is parked beside the east room.'
            : 'The restoration cart is turned toward the service corridor after the toast.',
        altText: 'Placeholder image for fictional gallery evidence.',
        metadata: { takenAt: occurredAt, location: 'East service corridor', device: 'Event camera' },
      };
    } else if (type === 'cctv') {
      title = 'CCTV: East Corridor';
      mediaStatus = 'placeholder';
      content = {
        cameraId: 'CAM-E2',
        location: 'East corridor',
        frames: Array.from({ length: 3 }, (_, frameIndex) => ({
          imageUrl: placeholderImage,
          timestamp: new Date(Date.parse(occurredAt) + frameIndex * 90_000).toISOString(),
          note: 'A figure passes the service entrance.',
        })),
        transcriptOrLog: 'Three still frames from the fictional east corridor camera.',
      };
    } else if (type === 'document') {
      title = index === 5 ? 'Restoration cart checkout' : `Gallery document ${index + 1}`;
      content = {
        docKind: 'report',
        contentMarkdown: `**Bellweather Gallery**\n\nCart checkout recorded at ${occurredAt}. The service cart was returned before closing.`,
      };
    } else if (type === 'call_log') {
      title = 'Front desk call log';
      content = {
        owner: 'Gallery front desk',
        entries: [
          { contact: 'Event desk', direction: 'in', time: occurredAt, durationSec: 42 },
          {
            contact: 'Security office',
            direction: 'out',
            time: new Date(Date.parse(occurredAt) + 8 * 60_000).toISOString(),
            durationSec: 81,
          },
        ],
      };
    } else {
      title = 'Event coordinator email';
      content = {
        from: 'Mara Ellis',
        to: ['Theo Venn'],
        subject: 'Closing checklist',
        sentAt: occurredAt,
        bodyText: 'Please return the restoration cart and confirm the east room is clear.',
      };
    }
    return { ...common, title, summary, content, ...(mediaStatus ? { mediaStatus } : {}) };
  });

  const clueMap = evidence.map((item) => ({
    clueId: item.clueId,
    pointsTo: item.pointsTo,
    kind: item.kind,
    description:
      item.kind === 'true_clue'
        ? `This evidence supports the deduction that ${suspectNames[1]} moved the painting.`
        : item.kind === 'red_herring'
          ? 'This points toward an innocent suspect but has a routine explanation.'
          : item.kind === 'alibi'
            ? 'This gives a verifiable account of an innocent suspect’s whereabouts.'
            : 'This supports the chronology without identifying the culprit.',
  }));

  return {
    title: 'The Bellweather Gallery Case',
    setting: { location: 'Bellweather Gallery', date: '2025-04-18', timeframe: '7:00 PM to 10:30 PM' },
    briefing: `During a private opening at the fictional Bellweather Gallery, a small portrait vanished from a locked east room while guests gathered for a charity toast. There were no broken windows and the gallery alarm stayed armed. The staff report that the painting was last seen shortly before the lights dimmed, but their accounts disagree about who moved a restoration cart and when the corridor was empty. The room contains a cast of people with access, overlapping schedules, and ordinary reasons to keep a few details private. Use the records and witness accounts to reconstruct the sequence. ${seed.slice(0, 160)} The details in this case are fictional, and every conclusion should follow from the evidence in the file.`,
    suspects,
    evidence,
    hidden: {
      truth: {
        culpritId,
        motive: 'Theo wanted to conceal a forged provenance record before the gallery’s review.',
        method:
          'Theo used a restoration cart to move the portrait into a service room while the room was briefly unattended.',
        timeline: [
          { time: '7:42 PM', event: 'The east room painting is confirmed in place.' },
          { time: '8:06 PM', event: 'Theo moves the restoration cart through the east corridor.' },
          { time: '8:14 PM', event: 'The portrait is found missing after the toast.' },
        ],
        explanation:
          'Theo Venn moved the portrait using a restoration cart. The chat, checkout record, and corridor image place Theo and the cart at the east room during the critical window. The suspicious guest schedule entries are explained by routine event duties.',
      },
      clueMap,
      hints: [
        'Compare the restoration cart records with the east corridor timeline.',
        'Look for a suspect whose written account conflicts with a time-stamped record.',
        'The cart checkout and the east corridor clues point to the same person.',
      ],
      validationReport: {
        mode: 'mock',
        passed: true,
        checkedAt: new Date().toISOString(),
        supportingClues: evidence.filter((item) => item.kind === 'true_clue').map((item) => item.id),
      },
    },
  };
}
