import { z } from 'zod';
const timestamp = z.string().min(1);
const suspectSchema = z.object({ id: z.string().min(1), name: z.string().min(1), role: z.string().min(1), background: z.string().min(1), alibi: z.string().min(1), possibleMotive: z.string().min(1) });
const evidenceSchema = z.object({ id: z.string().min(1), type: z.enum(['chat', 'image', 'cctv', 'document', 'witness', 'timeline']), title: z.string().min(1), description: z.string().min(1), content: z.unknown(), clueReferences: z.array(z.string()).default([]), timestamp: z.string().optional(), assetUrl: z.string().optional() });
const clueSchema = z.object({ id: z.string().min(1), description: z.string().min(1), evidenceReferences: z.array(z.string()).min(1), supportsConclusion: z.boolean() });
const rawCaseSchema = z.object({ schemaVersion: z.number().optional(), title: z.string().min(3), summary: z.string().min(20), difficulty: z.enum(['easy', 'medium', 'hard']), category: z.string(), incidentTimeline: z.array(z.object({ timestamp, event: z.string().min(1) })).min(3), suspects: z.array(suspectSchema).min(3).max(6), evidence: z.array(evidenceSchema).min(4), clues: z.array(clueSchema).min(2), solution: z.object({ culpritId: z.string(), motive: z.string().min(5), reconstruction: z.string().min(20), decisiveEvidenceIds: z.array(z.string()).min(2), explanation: z.string().min(20) }) });

export function validateGeneratedCase(input, expectedSuspects) {
  const data = rawCaseSchema.parse(input);
  if (data.suspects.length !== expectedSuspects) throw new Error('Generated suspect count did not match request');
  const unique = (items, label) => { const ids = items.map(item => item.id); if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} IDs`); };
  unique(data.suspects, 'suspect'); unique(data.evidence, 'evidence'); unique(data.clues, 'clue');
  const suspectIds = new Set(data.suspects.map(s => s.id)); const evidenceIds = new Set(data.evidence.map(e => e.id)); const clueIds = new Set(data.clues.map(c => c.id));
  if (!suspectIds.has(data.solution.culpritId)) throw new Error('Culprit is not a listed suspect');
  if (data.solution.decisiveEvidenceIds.some(id => !evidenceIds.has(id))) throw new Error('Solution references missing evidence');
  if (data.evidence.some(e => e.clueReferences.some(id => !clueIds.has(id)))) throw new Error('Evidence references missing clue');
  if (data.clues.some(c => c.evidenceReferences.some(id => !evidenceIds.has(id)))) throw new Error('Clue references missing evidence');
  return { ...data, schemaVersion: 1 };
}
