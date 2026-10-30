import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User, Mystery, Attempt, GenerationJob } from './models.js';
import { requireAuth, handleError, asyncRoute } from './middleware.js';
import { queueGeneration } from './services/generation.js';

export const app = express();
app.set('trust proxy', 1);
const configuredClientOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
const isAllowedOrigin = origin => origin === configuredClientOrigin || (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'"]
} } }));
app.use(cors({ origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)), credentials: true }));
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && !isAllowedOrigin(origin) && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return res.status(403).json({ success: false, error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Request origin is not allowed.' } });
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(session({ name: 'casefile.sid', secret: process.env.SESSION_SECRET || 'local-development-only-change-this-secret', resave: false, saveUninitialized: false,
  store: process.env.MONGODB_URI ? MongoStore.create({ mongoUrl: process.env.MONGODB_URI, collectionName: 'sessions' }) : undefined,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 14 } }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const generationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false });
const sendError = (res, status, code, message) => res.status(status).json({ success: false, error: { code, message } });
const safeUser = user => ({ id: user._id, name: user.name, email: user.email });
const safeCase = (m, attempt = null) => ({ id: m._id, title: m.title, summary: m.summary, originalScenario: m.originalScenario, category: m.category, difficulty: m.difficulty, status: m.status, schemaVersion: m.schemaVersion, suspects: m.suspects, evidence: m.evidence, clues: m.clues, incidentTimeline: m.incidentTimeline, createdAt: m.createdAt, updatedAt: m.updatedAt, ...(attempt ? { attempt: { selectedSuspectId: attempt.selectedSuspectId, isCorrect: attempt.isCorrect, submittedAt: attempt.submittedAt } } : {}) });
const safeResult = (m, attempt) => {
  const culprit = m.suspects.find(s => s.id === m.solution.culpritId);
  return { isCorrect: attempt.isCorrect, selectedSuspectId: attempt.selectedSuspectId, culprit: { id: culprit.id, name: culprit.name }, motive: m.solution.motive, reconstruction: m.solution.reconstruction, explanation: m.solution.explanation, decisiveEvidenceIds: m.solution.decisiveEvidenceIds, evidence: m.evidence.filter(e => m.solution.decisiveEvidenceIds.includes(e.id)).map(e => ({ id: e.id, title: e.title })) };
};

app.get('/api/v1/health', (req, res) => res.json({ success: true, status: 'ok' }));
app.post('/api/v1/auth/register', authLimiter, asyncRoute(async (req, res) => {
  const body = z.object({ name: z.string().trim().min(2).max(80), email: z.email().transform(v => v.toLowerCase()), password: z.string().min(8).max(128) }).parse(req.body);
  if (await User.exists({ email: body.email })) return sendError(res, 409, 'EMAIL_IN_USE', 'An account with that email already exists.');
  const user = await User.create({ name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 12) });
  req.session.userId = user.id; res.status(201).json({ success: true, user: safeUser(user) });
}));
app.post('/api/v1/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const body = z.object({ email: z.email().transform(v => v.toLowerCase()), password: z.string().min(1).max(128) }).parse(req.body);
  const user = await User.findOne({ email: body.email });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  req.session.userId = user.id; res.json({ success: true, user: safeUser(user) });
}));
app.post('/api/v1/auth/logout', (req, res, next) => req.session.destroy(err => { if (err) return next(err); res.clearCookie('casefile.sid'); res.json({ success: true }); }));
app.get('/api/v1/auth/me', requireAuth, asyncRoute(async (req, res) => {
  const user = await User.findById(req.session.userId).select('name email');
  if (!user) return sendError(res, 401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  res.json({ success: true, user: safeUser(user) });
}));

const scenarioSchema = z.object({ scenario: z.string().trim().min(30).max(2000), category: z.enum(['theft', 'murder mystery', 'missing person', 'corporate espionage', 'historical mystery', 'general mystery']).default('general mystery'), difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'), suspectCount: z.coerce.number().int().min(3).max(6).default(4), evidencePreferences: z.array(z.enum(['chat', 'image', 'cctv', 'document', 'witness', 'timeline'])).max(6).default([]) });
app.post('/api/v1/mysteries', requireAuth, generationLimiter, asyncRoute(async (req, res) => {
  const settings = scenarioSchema.parse(req.body);
  const mystery = await Mystery.create({ ownerId: req.session.userId, originalScenario: settings.scenario, category: settings.category, difficulty: settings.difficulty, status: 'generating', generationSettings: settings });
  const job = await GenerationJob.create({ ownerId: req.session.userId, mysteryId: mystery._id });
  mystery.generationJobId = job._id; await mystery.save(); queueGeneration(job._id, settings);
  res.status(202).json({ success: true, jobId: job.id, mysteryId: mystery.id });
}));
app.get('/api/v1/mysteries', requireAuth, asyncRoute(async (req, res) => {
  const [mysteries, attempts] = await Promise.all([Mystery.find({ ownerId: req.session.userId }).sort({ createdAt: -1 }).select('-solution -generationSettings').lean(), Attempt.find({ userId: req.session.userId }).lean()]);
  const byMystery = new Map(attempts.map(a => [String(a.mysteryId), a]));
  res.json({ success: true, mysteries: mysteries.map(m => safeCase(m, byMystery.get(String(m._id)))) });
}));
app.get('/api/v1/mysteries/:id', requireAuth, asyncRoute(async (req, res) => {
  const mystery = await Mystery.findOne({ _id: req.params.id, ownerId: req.session.userId }).select('-solution -generationSettings');
  if (!mystery) return sendError(res, 404, 'NOT_FOUND', 'Case not found.');
  const attempt = await Attempt.findOne({ mysteryId: mystery._id, userId: req.session.userId }); res.json({ success: true, mystery: safeCase(mystery, attempt) });
}));
app.delete('/api/v1/mysteries/:id', requireAuth, asyncRoute(async (req, res) => {
  const mystery = await Mystery.findOneAndDelete({ _id: req.params.id, ownerId: req.session.userId });
  if (!mystery) return sendError(res, 404, 'NOT_FOUND', 'Case not found.');
  await Promise.all([Attempt.deleteMany({ mysteryId: mystery._id }), GenerationJob.deleteMany({ mysteryId: mystery._id })]); res.json({ success: true });
}));
app.get('/api/v1/mysteries/:id/evidence', requireAuth, asyncRoute(async (req, res) => {
  const mystery = await Mystery.findOne({ _id: req.params.id, ownerId: req.session.userId }).select('evidence');
  if (!mystery) return sendError(res, 404, 'NOT_FOUND', 'Case not found.'); res.json({ success: true, evidence: mystery.evidence });
}));
app.get('/api/v1/mysteries/:id/evidence/:evidenceId', requireAuth, asyncRoute(async (req, res) => {
  const mystery = await Mystery.findOne({ _id: req.params.id, ownerId: req.session.userId }).select('evidence');
  const evidence = mystery?.evidence.find(item => item.id === req.params.evidenceId);
  if (!evidence) return sendError(res, 404, 'NOT_FOUND', 'Evidence not found.'); res.json({ success: true, evidence });
}));
app.get('/api/v1/jobs/:id', requireAuth, asyncRoute(async (req, res) => {
  const job = await GenerationJob.findOne({ _id: req.params.id, ownerId: req.session.userId }).select('status errorCode retryCount mysteryId');
  if (!job) return sendError(res, 404, 'NOT_FOUND', 'Generation job not found.');
  res.json({ success: true, job: { id: job.id, status: job.status, errorCode: job.errorCode, retryCount: job.retryCount, mysteryId: job.mysteryId } });
}));
app.post('/api/v1/jobs/:id/retry', requireAuth, generationLimiter, asyncRoute(async (req, res) => {
  const job = await GenerationJob.findOne({ _id: req.params.id, ownerId: req.session.userId });
  if (!job) return sendError(res, 404, 'NOT_FOUND', 'Generation job not found.');
  if (job.status !== 'failed') return sendError(res, 409, 'JOB_NOT_RETRYABLE', 'Only failed jobs can be retried.');
  if (job.retryCount >= 2) return sendError(res, 429, 'RETRY_LIMIT', 'This case has reached its retry limit.');
  const mystery = await Mystery.findById(job.mysteryId).select('+generationSettings');
  if (!mystery) return sendError(res, 404, 'NOT_FOUND', 'Case not found.');
  job.status = 'queued'; job.errorCode = undefined; await job.save(); mystery.status = 'generating'; await mystery.save(); queueGeneration(job._id, mystery.generationSettings, true);
  res.status(202).json({ success: true, jobId: job.id, mysteryId: mystery.id });
}));
app.post('/api/v1/mysteries/:id/accusations', requireAuth, asyncRoute(async (req, res) => {
  const { selectedSuspectId } = z.object({ selectedSuspectId: z.string().min(1) }).parse(req.body);
  const mystery = await Mystery.findOne({ _id: req.params.id, ownerId: req.session.userId }).select('+solution');
  if (!mystery) return sendError(res, 404, 'NOT_FOUND', 'Case not found.');
  if (!['ready', 'completed'].includes(mystery.status)) return sendError(res, 409, 'CASE_NOT_READY', 'This case is not ready for an accusation.');
  if (!mystery.suspects.some(s => s.id === selectedSuspectId)) return sendError(res, 422, 'INVALID_SUSPECT', 'Choose a suspect from this case.');
  const existing = await Attempt.findOne({ mysteryId: mystery._id, userId: req.session.userId });
  if (existing) return sendError(res, 409, 'ALREADY_SUBMITTED', 'Your final accusation has already been submitted.');
  const attempt = await Attempt.create({ mysteryId: mystery._id, userId: req.session.userId, selectedSuspectId, isCorrect: selectedSuspectId === mystery.solution.culpritId });
  mystery.status = 'completed'; await mystery.save(); res.json({ success: true, result: safeResult(mystery, attempt) });
}));
app.get('/api/v1/mysteries/:id/result', requireAuth, asyncRoute(async (req, res) => {
  const mystery = await Mystery.findOne({ _id: req.params.id, ownerId: req.session.userId }).select('+solution');
  const attempt = mystery && await Attempt.findOne({ mysteryId: mystery._id, userId: req.session.userId });
  if (!mystery || !attempt) return sendError(res, 404, 'NOT_FOUND', 'Completed result not found.'); res.json({ success: true, result: safeResult(mystery, attempt) });
}));
app.use('/api', (req, res) => sendError(res, 404, 'NOT_FOUND', 'API route not found.'));
app.use(handleError);
