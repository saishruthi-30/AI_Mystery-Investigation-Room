import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { Mystery, GenerationJob } from '../models.js';
import { validateGeneratedCase } from './caseValidation.js';
import { buildMysteryPrompt } from '../prompts/mysteryPrompt.js';
const text = { type: Type.STRING };
const generationSchema = {
  type: Type.OBJECT,
  properties: {
    schemaVersion: { type: Type.INTEGER }, title: text, summary: text, difficulty: { type: Type.STRING, enum: ['easy', 'medium', 'hard'] }, category: text,
    incidentTimeline: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { timestamp: text, event: text }, required: ['timestamp', 'event'] } },
    suspects: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: text, name: text, role: text, background: text, alibi: text, possibleMotive: text }, required: ['id', 'name', 'role', 'background', 'alibi', 'possibleMotive'] } },
    evidence: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: text, type: { type: Type.STRING, enum: ['chat', 'image', 'cctv', 'document', 'witness', 'timeline'] }, title: text, description: text, content: { type: Type.OBJECT, properties: { messages: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { sender: text, timestamp: text, text }, required: ['sender', 'timestamp', 'text'] } }, frames: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { timestamp: text, event: text }, required: ['timestamp', 'event'] } }, description: text, transcript: text, text }, required: [] }, clueReferences: { type: Type.ARRAY, items: text }, timestamp: text }, required: ['id', 'type', 'title', 'description', 'content', 'clueReferences'] } },
    clues: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: text, description: text, evidenceReferences: { type: Type.ARRAY, items: text }, supportsConclusion: { type: Type.BOOLEAN } }, required: ['id', 'description', 'evidenceReferences', 'supportsConclusion'] } },
    solution: { type: Type.OBJECT, properties: { culpritId: text, motive: text, reconstruction: text, decisiveEvidenceIds: { type: Type.ARRAY, items: text }, explanation: text }, required: ['culpritId', 'motive', 'reconstruction', 'decisiveEvidenceIds', 'explanation'] }
  },
  required: ['title', 'summary', 'difficulty', 'category', 'incidentTimeline', 'suspects', 'evidence', 'clues', 'solution']
};

async function generateWithGemini(settings, model) {
  if (!process.env.GEMINI_API_KEY) throw new Error('AI_PROVIDER_NOT_CONFIGURED');
  // The SDK retries 5xx and network failures by default. Keep retries explicit here
  // so a busy primary model can fail over promptly instead of multiplying wait time.
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, maxRetries: 0, timeout: 25000 });
  const response = await ai.models.generateContent({ model, contents: buildMysteryPrompt(settings), config: {
    responseMimeType: 'application/json', responseSchema: generationSchema, maxOutputTokens: 5000,
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
  } });
  if (!response.text) throw new Error('AI_EMPTY_RESPONSE');
  return JSON.parse(response.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}

function isTransientProviderError(error) {
  const message = String(error?.message || '').toLowerCase();
  const status = Number(error?.status || error?.code);
  return [408, 429, 500, 502, 503, 504].includes(status) || /unavailable|resource_exhausted|rate.?limit|\b50[0234]\b|\b429\b|fetch failed|network|timed out|econnreset|eai_again/.test(message);
}

function canTryFallback(error) {
  return isTransientProviderError(error) || error?.name === 'SyntaxError' || error?.name === 'ZodError' || /ai_empty_response|generated .*|duplicate .* ids|references missing|culprit is not|at least two decisive/i.test(String(error?.message || ''));
}

async function generateValidatedCase(settings) {
  const primary = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const fallback = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
  const models = [...new Set([primary, fallback])];
  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    try {
      const generated = await generateWithGemini(settings, model);
      return validateGeneratedCase(generated, settings.suspectCount);
    } catch (error) {
      const hasFallback = modelIndex < models.length - 1 && canTryFallback(error);
      console.warn('Gemini generation attempt failed.', { model, hasFallback, transient: isTransientProviderError(error) });
      if (hasFallback) continue;
      throw error;
    }
  }
  throw new Error('GENERATION_FAILED');
}

export async function processGeneration(jobId, settings, retry = false) {
  const job = await GenerationJob.findById(jobId); if (!job) return;
  const mystery = await Mystery.findById(job.mysteryId); if (!mystery) return;
  job.status = 'processing'; job.startedAt = new Date(); if (retry) job.retryCount += 1; await job.save();
  try {
    const validCase = await generateValidatedCase(settings);
    mystery.title = validCase.title; mystery.summary = validCase.summary; mystery.schemaVersion = validCase.schemaVersion;
    mystery.suspects = validCase.suspects; mystery.evidence = validCase.evidence.map(item => ({ ...item, createdAt: new Date() }));
    mystery.clues = validCase.clues; mystery.incidentTimeline = validCase.incidentTimeline; mystery.solution = validCase.solution;
    mystery.status = 'ready'; mystery.promptVersion = 'v1'; await mystery.save();
    job.status = 'completed'; job.completedAt = new Date(); job.errorCode = undefined; await job.save();
  } catch (error) {
    const temporary = isTransientProviderError(error);
    console.error('Mystery generation failed:', temporary ? 'temporary Gemini/network error' : error.message);
    mystery.status = 'failed'; await mystery.save();
    job.status = 'failed';
    job.errorCode = error.message === 'AI_PROVIDER_NOT_CONFIGURED' ? 'AI_NOT_CONFIGURED' : temporary ? 'AI_TEMPORARILY_UNAVAILABLE' : 'GENERATION_FAILED';
    job.completedAt = new Date(); await job.save();
  }
}
export function queueGeneration(jobId, settings, retry = false) { setImmediate(() => processGeneration(jobId, settings, retry)); }
