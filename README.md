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

## Deploy to Render

This repository includes [`render.yaml`](./render.yaml), a Render Blueprint that builds the React client and serves it from Express on the same HTTPS origin. MongoDB Atlas stores users, cases, sessions, and generation jobs; Gemini remains a server-only integration.

1. **Rotate any exposed credentials before deploying.** Replace the Gemini API key and MongoDB database-user password shown in any previous screenshots or terminal captures. Update local `.env`, but never add `.env` or `.env.` to Git. `.gitignore` excludes both.
2. **Create or confirm MongoDB Atlas.** Create a cluster in AWS Singapore to match the Render region, and create a database user with access to the app database. Copy the `mongodb+srv://` application connection string. Use a strong new password and URL-encode reserved characters if you put them in the URI. You will add Render's outbound IP ranges after creating the Render service. Avoid `0.0.0.0/0` for production. See [Render's Atlas connection guide](https://render.com/docs/connect-to-mongodb-atlas).
3. **Push the project to a private GitHub repository.** Confirm `.env` and `.env.` are ignored before the first push. Keep `.env.example`; it contains placeholders only.
4. **Create the Render service.** In Render, choose **New → Blueprint**, connect the repository, and select the root `render.yaml`. The Blueprint sets the Node build/start commands, Singapore region, and `/api/v1/health` health check.
5. **Provide the two prompted secrets.** Enter the rotated Atlas `MONGODB_URI` and a newly created `GEMINI_API_KEY`. Render generates `SESSION_SECRET`. Never use the values from a screenshot. The first deploy may not connect to Atlas until its IP ranges are allowlisted.
6. **Allowlist Render in Atlas.** In Render, open the service’s **Connect → Outbound** panel and copy its IP ranges. Add those ranges in Atlas **Network Access**. If the first deploy failed because Atlas blocked the connection, trigger a redeploy after saving the allowlist. Avoid leaving a broad `0.0.0.0/0` entry. See [Render outbound IP addresses](https://render.com/docs/outbound-ip-addresses).
7. **Confirm the deploy.** Wait for `npm ci`, `npm run build`, and `npm start` to finish. Render must report the health check as successful and the logs should show MongoDB connected. Open the generated `https://<service>.onrender.com` URL, register an account, and create a case. `/api/v1/health` should return `{"success":true,"status":"ok"}`.

The Blueprint uses Render’s Free web plan so it does not create a paid service automatically. Free services spin down after 15 minutes idle and can take about a minute to wake; choose an always-on paid instance in Render if that delay is unacceptable. Case generation still depends on Gemini availability and response time. See [Render’s Free plan limitations](https://render.com/docs/free).

### Production notes

- The app reads Render’s `PORT`, serves the built Vite files from `dist/`, and uses `RENDER_EXTERNAL_URL` for its production origin. No frontend `CLIENT_URL` is needed for the same-origin deployment.
- The generation worker runs in the web process and stores job status in MongoDB. Keep one web instance for this MVP; a restart during generation may interrupt that job. Use a durable queue before scaling to multiple instances or promising uninterrupted background work.
- Render’s filesystem is ephemeral, so do not store uploaded media there. The MVP keeps generated visual evidence as text and does not need local asset files.
- Keep `GEMINI_API_KEY`, `MONGODB_URI`, and `SESSION_SECRET` in Render’s Environment settings only. They must never be placed in `VITE_*` variables or committed files.
