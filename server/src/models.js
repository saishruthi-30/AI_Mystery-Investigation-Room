import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const userSchema = new Schema({ name: { type: String, required: true, trim: true, maxlength: 80 }, email: { type: String, required: true, unique: true, lowercase: true, trim: true }, passwordHash: { type: String, required: true } }, { timestamps: true });
const mysterySchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, title: { type: String, default: 'Untitled case' }, summary: String,
  originalScenario: { type: String, required: true, maxlength: 2000 }, category: { type: String, required: true }, difficulty: { type: String, required: true },
  status: { type: String, enum: ['generating', 'ready', 'failed', 'completed'], default: 'generating', index: true }, schemaVersion: { type: Number, default: 1 },
  suspects: { type: [Schema.Types.Mixed], default: [] }, evidence: { type: [Schema.Types.Mixed], default: [] }, clues: { type: [Schema.Types.Mixed], default: [] },
  incidentTimeline: { type: [Schema.Types.Mixed], default: [] }, solution: { type: Schema.Types.Mixed, select: false }, generationSettings: { type: Schema.Types.Mixed, select: false }, generationJobId: { type: Schema.Types.ObjectId, ref: 'GenerationJob' }, promptVersion: { type: String, default: 'v1' }
}, { timestamps: true, minimize: false });
const attemptSchema = new Schema({ mysteryId: { type: Schema.Types.ObjectId, ref: 'Mystery', required: true }, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, selectedSuspectId: { type: String, required: true }, isCorrect: { type: Boolean, required: true }, submittedAt: { type: Date, default: Date.now } }, { timestamps: true });
attemptSchema.index({ mysteryId: 1, userId: 1 }, { unique: true });
const jobSchema = new Schema({ ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, mysteryId: { type: Schema.Types.ObjectId, ref: 'Mystery', required: true }, status: { type: String, enum: ['queued', 'processing', 'completed', 'failed'], default: 'queued' }, errorCode: String, retryCount: { type: Number, default: 0 }, startedAt: Date, completedAt: Date }, { timestamps: true });
export const User = model('User', userSchema);
export const Mystery = model('Mystery', mysterySchema);
export const Attempt = model('Attempt', attemptSchema);
export const GenerationJob = model('GenerationJob', jobSchema);
