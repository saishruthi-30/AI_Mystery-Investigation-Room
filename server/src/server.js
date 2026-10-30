import 'dotenv/config';
import { connectDatabase } from './config/db.js';
import { app } from './app.js';
const port = Number(process.env.PORT || 5000);
try {
  if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) throw new Error('SESSION_SECRET must contain at least 32 characters in production');
  await connectDatabase();
  app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
}
catch (error) { console.error('Unable to start server:', error.message); process.exit(1); }
