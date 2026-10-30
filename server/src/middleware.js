export function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
  next();
}
export function handleError(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error?.code === 11000) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'This request conflicts with an existing record.' } });
  if (error?.name === 'CastError') return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
  if (error?.name === 'ZodError') return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: error.issues?.[0]?.message || 'Please check your input.' } });
  console.error(error); res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}
export const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
