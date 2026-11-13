# AI Mystery Room

Type a one-line scenario and get a complete, solvable fictional mystery: suspects, a hidden truth with exactly one culprit, and evidence such as WhatsApp chats, CCTV frames, photos, call logs, emails and documents. Investigate, then accuse.

> **Status:** in development. Phases A (foundation) and B (real Gemini generation) are complete. See [`docs/PROJECT_AUDIT.md`](docs/PROJECT_AUDIT.md) for the roadmap and [`spec.md`](spec.md) for the full specification.

## Stack

npm workspaces monorepo, TypeScript everywhere.

| Part      | Tech                                                                 |
| --------- | -------------------------------------------------------------------- |
| `client/` | React 19, Vite 7, React Router 7, TanStack Query, Tailwind CSS       |
| `server/` | Node.js, Express 5, Mongoose 8 (MongoDB), Zod, pino, `@google/genai` |
| `shared/` | Zod schemas and types used by both client and server                 |

## Quick start (macOS)

You need **Node.js 20+** and **MongoDB**. These steps take about 10 minutes.

### 1. Install tools

```bash
# Node.js (skip if `node -v` already prints v20 or newer)
brew install node

# MongoDB Community Edition
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb/brew/mongodb-community
```

If Homebrew says the `mongodb/brew` tap is untrusted, run `brew trust mongodb/brew` (MongoDB's official tap) and repeat the install.

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
# Put a random session secret into server/.env:
sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" server/.env
```

The defaults use local MongoDB and **mock mode** (`MOCK_GEMINI=true`), so no API key is needed.

To generate real AI cases, get a key at https://aistudio.google.com/apikey, then in `server/.env` set `GEMINI_API_KEY=<your key>` and `MOCK_GEMINI=false`, and restart `npm run dev`. A case takes about 1-2 minutes and roughly 5-8 AI calls on the free tier. Model names change often; list the ones your key can use with:

```bash
curl -s -H "x-goog-api-key: $(grep ^GEMINI_API_KEY= server/.env | cut -d= -f2-)" \
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" | grep '"name"'
```

### 4. Run

```bash
npm run dev
```

- App: http://localhost:5173
- API health: http://localhost:5173/api/health (proxied to the API on port 5050)

Stop with `Ctrl+C`. To stop MongoDB: `brew services stop mongodb/brew/mongodb-community`.

## Scripts

| Command                                   | What it does                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Builds `shared`, then runs the API (port 5050) and client (port 5173)                                             |
| `npm test`                                | Unit and API tests (Vitest + Supertest; no database needed)                                                       |
| `npm run e2e`                             | Browser smoke tests (Playwright). Needs MongoDB running; first run `npx playwright install --only-shell chromium` |
| `npm run lint` / `npm run typecheck`      | ESLint / TypeScript checks                                                                                        |
| `npm run format` / `npm run format:check` | Prettier                                                                                                          |
| `npm run build`                           | Production build of all workspaces                                                                                |

## Environment variables

### Server (`server/.env`)

| Variable                                       | Default                                     | Notes                                                                                       |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `PORT`                                         | `5050`                                      | 5000 is taken by macOS AirPlay Receiver                                                     |
| `MONGODB_URI`                                  | `mongodb://127.0.0.1:27017/ai-mystery-room` | Atlas: `mongodb+srv://<user>:<password>@<host>/ai-mystery-room`                             |
| `JWT_SECRET`                                   | —                                           | **Required**, 32+ random characters                                                         |
| `CLIENT_ORIGIN`                                | `http://localhost:5173`                     | Only origin allowed by CORS                                                                 |
| `COOKIE_SECURE`                                | `false`                                     | Forced on when `NODE_ENV=production`                                                        |
| `MOCK_GEMINI`                                  | `true` in example                           | `true` = deterministic fixture cases, no API calls                                          |
| `GEMINI_API_KEY`                               | empty                                       | Required only when `MOCK_GEMINI=false`. Server-only, never sent to the browser              |
| `GEMINI_TEXT_MODEL` / `GEMINI_VALIDATOR_MODEL` | `gemini-3.5-flash`                          | Blueprint writer / blind solvability check                                                  |
| `GEMINI_FAST_MODEL`                            | `gemini-3.5-flash-lite`                     | Evidence writing and seed safety screening                                                  |
| `GEMINI_FALLBACK_MODEL`                        | `gemini-3.5-flash-lite`                     | Used once when a model is overloaded or times out                                           |
| `GEMINI_TEXT_TIMEOUT_MS`                       | `120000`                                    | Per-call timeout                                                                            |
| `ENABLE_IMAGE_GENERATION`                      | `false`                                     | AI portraits, photos and CCTV frames. Needs a billing-enabled key (free tier: 0 images/day) |
| `GEMINI_IMAGE_MODEL`                           | `gemini-nano-banana-2.1`                    | Only used when images are enabled                                                           |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`          | `local`, `./storage`                        | Generated images                                                                            |
| `GENERATION_CONCURRENCY`                       | `2`                                         | Parallel case generations                                                                   |
| `MAX_GENERATIONS_PER_DAY_USER` / `_GUEST`      | `10` / `3`                                  | Per-user daily limits                                                                       |
| `RATE_LIMIT_*`                                 | see `server/src/config/env.ts`              | Per-IP limits (global, polling, auth, generation)                                           |
| `LOG_LEVEL`                                    | `info` (`silent` in tests)                  | pino level                                                                                  |

### Client (`client/.env`)

| Variable            | Notes                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `VITE_API_BASE_URL` | Leave empty in development (Vite proxies `/api`). Set only if the API is on another origin |

Never put secrets in `client/.env`: every `VITE_*` value is bundled into the browser code.

## Architecture

```
React SPA ──/api──▶ Express API ──▶ MongoDB
 (Vite)   ◀─poll──  ├─ routes → controllers → services
                    ├─ in-process job queue (case generation)
                    ├─ Gemini client (structured JSON, retries, safety)
                    └─ storage driver (local files, auth-checked media route)
```

- Case generation is asynchronous: `POST /api/cases` returns `202`, and the client polls `/api/cases/:id/status` every 2 seconds.
- **Spoiler safety:** the hidden solution (culprit, clue map, hints) is stored in fields excluded from queries by default and is never sent to the browser before a case is resolved.
- Security: helmet headers, strict CORS, rate limits, 100 kB body limit, Zod validation on every route, httpOnly `SameSite=Lax` session cookie, bcrypt password hashing.

Design decisions are logged in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Using MongoDB Atlas instead of local MongoDB

1. Create a free M0 cluster at https://cloud.mongodb.com.
2. Under **Database Access**, create a database user with a strong generated password.
3. Under **Network Access**, allow your IP address.
4. Put the connection string in `server/.env` as `MONGODB_URI`. Never commit it.

## Troubleshooting

| Problem                                  | Fix                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `Port 5050 is already in use`            | Another API instance is running: `lsof -nP -iTCP:5050 -sTCP:LISTEN` |
| Health shows `"database":"disconnected"` | Start MongoDB: `brew services start mongodb/brew/mongodb-community` |
| `Invalid server environment` on start    | Check `server/.env`, usually a missing or placeholder `JWT_SECRET`  |
