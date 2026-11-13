# Implementation decisions

## M1 Foundation

- **DEC-001 — Mongo health behavior:** `/api/health` always responds with process health and reports MongoDB connection state separately. This keeps the endpoint useful while a local database is starting.
- **DEC-002 — Frontend theme:** The initial shell uses a responsive dark case-file theme that can be extended during later gameplay milestones.
- **DEC-003 — Milestone scope:** Work follows `spec.md` Section 20; later milestone features are intentionally not scaffolded as functional flows before earlier acceptance criteria are met.
- **DEC-004 — Optional object storage:** M4 implements the storage interface and local driver. S3 remains optional and deferred; configuring `STORAGE_DRIVER=s3` fails clearly until its driver is added.

## Phase A — Hygiene & foundation gaps (2026-11-14)

- **DEC-005 — Leaked credentials:** The original `server/.env.example` contained a live MongoDB Atlas connection string. It was replaced with a local placeholder. The Atlas user password must be rotated by the account owner; the old value remains in public git history and must never be reused.
- **DEC-006 — Mongo query sanitisation:** `express-mongo-sanitize` is incompatible with Express 5 (it reassigns the read-only `req.query`). Instead, `middleware/security.ts#rejectMongoOperators` rejects any body key starting with `$` or containing `.`, all bodies are parsed by strict Zod schemas, and route params are validated (e.g. `CaseIdSchema`). Mongoose's global `sanitizeFilter` was **not** enabled because it would neutralise the server's own `$in`/`$gte`/`$exists` filters.
- **DEC-007 — Rate-limit buckets:** Spec §15.4 sets a global limit of 100 requests / 15 min / IP, but status polling every 2 s (§4) alone needs ~450 / 15 min. `GET /api/cases/:id/status` and `GET /api/media/*` therefore use a separate polling bucket (default 1000 / 15 min). Auth endpoints (register, login, guest, upgrade) share a stricter bucket (20 / 15 min); case creation has a per-IP cap (20 / hour) on top of FR-06 per-user limits. All limits are env-configurable and return the standard `RATE_LIMITED` error body.
- **DEC-008 — API port 5050 and Vite proxy:** macOS reserves port 5000 for AirPlay Receiver, so the spec's default `PORT=5000` silently fails on Macs. The API defaults to **5050**. In development the client calls same-origin `/api` and Vite proxies it to the API, so session cookies are first-party and no CORS preflight is needed. `VITE_API_BASE_URL` still overrides this for split-origin deployments, and CORS remains restricted to `CLIENT_ORIGIN`.
- **DEC-009 — `GET /api/auth/me` when signed out:** Returns `200 { "user": null }` instead of `401`, so anonymous visitors on public pages do not produce failed-request console errors. A tampered or expired cookie is treated as signed out and cleared. All other protected routes still return `401 UNAUTHENTICATED`.
- **DEC-010 — Database unavailability:** Mongoose `bufferTimeoutMS` is 3 s (fail fast instead of 10 s hangs). The server keeps retrying the initial connection with backoff, and database errors map to HTTP 503 with code `INTERNAL` (the spec's error code list has no dedicated code).
- **DEC-011 — Malformed bodies:** Invalid JSON returns `400 VALIDATION_ERROR`; bodies over 100 kB return `413 VALIDATION_ERROR`.
- **DEC-012 — Logging:** pino + pino-http with a request ID per request (`X-Request-Id`, accepted from the caller if well-formed). Cookies, authorization headers, passwords and API keys are redacted; request bodies are never logged. Logs are silent under `NODE_ENV=test`.
- **DEC-013 — Default Gemini model names:** Defaults reset to the spec §17 suggestions (`gemini-2.5-flash`, `gemini-2.5-flash-image`). They must be verified against Google's current model list in Phase B before real generation is accepted.
- **DEC-014 — Playwright installed early:** The spec's E2E smoke test (§18) was added in Phase A to verify the UI in a real browser after each phase. It runs desktop and mobile (Pixel 7) projects against mock Gemini.
