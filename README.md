# Casefile — AI Mystery Room

Create a fictional investigation, inspect its evidence, and make one final accusation. The project uses React + Vite, Express, MongoDB/Mongoose, and Google's Gemini API. The backend stores the solution and checks accusations; pre-accusation case responses never include it.

## Requirements

- Node.js 20 or newer
- MongoDB (local or hosted)
- A Gemini API key for AI case generation

Cases, people, conversations, and records are fictional. Image descriptions and CCTV reconstructions are labeled as simulated evidence; optional image/video providers are not required. Generation uses `GEMINI_MODEL` first and switches to `GEMINI_FALLBACK_MODEL` for transient provider/network failures or invalid generated output.

## Local setup

1. Copy `.env.example` to `.env` and set `MONGODB_URI`, `SESSION_SECRET`, and `GEMINI_API_KEY`.
2. Install dependencies with `npm install`.
3. Start the client and API with `npm run dev`.
4. Open `http://localhost:5173`.

The API runs on port 5000 by default, and the Vite development server proxies `/api` requests to it. `CLIENT_URL` controls the allowed browser origin. Generation needs a Gemini key; the rest of the application starts without optional visual generation providers. MongoDB is required for authentication, sessions, and persistence.

## Commands

- `npm run dev` — Vite and Express development servers
- `npm run build` — production frontend bundle in `dist/`
- `npm start` — Express API

## Main routes

- `/` landing page
- `/register`, `/login` account access
- `/create` scenario and generation options
- `/mysteries/:id` investigation room
- `/mysteries/:id/results` submitted result and solution
- `/history` saved investigations
- `/profile` account details

REST API base: `/api/v1`. Authentication uses an HTTP-only session cookie stored in MongoDB. Passwords use bcrypt. Cases, generation jobs, and one-time accusations are scoped to their owner.

## Project layout

- `client/src` — React pages, API helper, and design system
- `server/src` — Express API, Mongoose models, Gemini generation, validation, and prompts
- `spec.md` — product and technical source of truth

Generation runs as an in-process asynchronous job with a bounded schema validation retry. In production, serve the frontend and API under the same origin or configure a reverse proxy for `/api`. For multiple API instances or durable queued work, move the job runner to a shared queue before scaling horizontally.
