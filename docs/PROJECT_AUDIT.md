# AI Mystery Room — Project Audit

**Date:** 2026-11-14 · **Audited commit:** `f16082f` ("Initial commit - AI Mystery Room") · **Source of truth:** `spec.md` v1.0

Every result below comes from running the tools on a Mac (Node 26.5, npm 11.17); nothing is guessed.

| Check | Result |
|---|---|
| `npm ci` | ✅ installs (npm 11 blocks esbuild/protobufjs postinstall scripts; build and tests still work) |
| `npm test` (Vitest) | ✅ 11 files, 50 tests pass |
| `npm run typecheck` | ✅ shared, server and client clean |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ client bundle is 309 kB JS (97 kB gzip) |
| Server boot (mock mode, no DB) | ✅ listens; `/api/health` returns `degraded` with `database: connecting` |
| Real MongoDB | ⚠️ not tested: no local MongoDB, and I did not use the Atlas credentials committed in the repo (see S-1) |
| Real Gemini | ⚠️ not tested: no API key available |

---

## 1. Critical security findings (fix before anything else)

| ID | Severity | Finding | Action |
|---|---|---|---|
| **S-1** | 🔴 Critical | `server/.env.example` contains what looks like a **real MongoDB Atlas username and password**, committed to a **public** GitHub repo. | **Rotate that Atlas database user's password now** (Atlas → Database Access). Replace the line with a placeholder. Rotation is what matters: removing the line later does not remove it from git history or forks. |
| S-2 | 🟠 High | Spec §15.4 hardening is missing: no `helmet`, no `express-rate-limit` (global, auth, or generation), no `express-mongo-sanitize`. Login has no brute-force protection. | Milestone A |
| S-3 | 🟡 Medium | Sending malformed JSON returns **500 `INTERNAL`** instead of 400 `VALIDATION_ERROR`, because `errorHandler` doesn't recognise body-parser errors. | Milestone A |
| S-4 | 🟡 Medium | No structured logging (pino + request IDs, NFR-07). `errorHandler` logs raw errors that may include provider messages. | Milestone A / M7 |
| S-5 | 🟢 Low | With no database, Mongoose queues queries, so requests hang about 10 s instead of failing fast. I saw this when calling `POST /auth/guest` during the audit. | Milestone A |

No API key is exposed to the client: `GEMINI_API_KEY` appears only in `server/src/config/env.ts` and the Gemini client, and the client reads only `VITE_API_BASE_URL`.

---

## 2. Architecture (as built)

The structure follows spec §5 closely: an npm-workspaces monorepo with `shared/`, `server/` and `client/`.

```
client (React 19 + Vite 7 + TanStack Query + RR7 + Tailwind 3)  ── single App.tsx (226 lines)
   │  fetch, credentials: 'include'
server (Express 5 + Mongoose 8 + Zod 3 + @google/genai 2.31)
   ├─ routes: health, auth, cases (create + status only), media
   ├─ jobs/queue.ts            in-process queue behind a JobQueue interface ✅
   ├─ services/caseGeneration  mock pipeline + dispatch to real pipeline
   ├─ services/realCaseGeneration  Stages 1-5 against Gemini (mock-tested)
   ├─ services/gemini/         client, schemas, prompts, safety, error mapping
   └─ services/storage/        StorageDriver interface + local driver
shared (Zod enums, CaseCreationSchema, HealthResponseSchema)
```

---

## 3. Status by milestone (spec §20)

Legend: ✅ done and verified · 🟡 partial or untested · ❌ missing

### M1 Foundation: 🟡 mostly done
| Item | Status | Notes |
|---|---|---|
| Monorepo, strict TS, ESLint | ✅ | |
| Prettier | ❌ | Listed in spec §3 |
| Zod-validated env | ✅ | `config/env.ts` |
| Express + Mongo connect + `/api/health` | ✅ | Health reports DB state (DEC-001) |
| Vite shell, routing, theme | 🟡 | Uses Georgia/Arial, not Playfair Display / Inter / monospace as §12.2 asks |
| CI (lint + tests) | ❌ | No `.github/workflows` |
| `npm run dev` starts both | 🟡 | Script exists; not run end-to-end with a real DB |
| `client/.env.example` | ❌ | Required by §17 |
| README | ❌ | **No README in the repo**; required by DoD §21 |

### M2 Auth: 🟡 API done, client and one bug outstanding
| Item | Status | Notes |
|---|---|---|
| API-02…07 (register/login/guest/logout/me/upgrade) | ✅ | bcrypt cost 12, httpOnly + SameSite=Lax cookie, 7-day JWT |
| Guest TTL index | ✅ | `User.guestExpiresAt`, partial on `isGuest` |
| **FR-03 bug** | ❌ | Upgrading a guest does **not** clear `expiresAt` on the guest's cases, so the TTL index **still deletes their cases after 7 days**. |
| Client login/register/guest | ✅ | |
| Client "upgrade guest" UI | ❌ | |
| Auth tests | 🟡 | 4 tests; no login-failure or duplicate-email tests |

### M3 Generation pipeline (mock-first): ✅ mostly done
| Item | Status | Notes |
|---|---|---|
| Case model, job queue, mock stages, progress | ✅ | |
| `POST /api/cases` (202) + `GET /:id/status` | ✅ | Ownership enforced |
| Limits (2 concurrent, daily) → 429 | ✅ | Tested |
| Stuck-case cleanup on boot (NFR-04) | ✅ | Tested |
| Generating screen with polling | ✅ | |
| `API-13 POST /:id/regenerate` | ❌ | NFR-04 says "with retry available" |
| **Latent bug** | ❌ | Shared `CaseStatusSchema` has no `in_progress` or `resolved`, so `/status` will **throw a 500** once gameplay moves a case into either state. |
| Mock mode skips Stage 3 media | 🟡 | Uses placeholders directly; acceptable for mock |

### M4 Real Gemini integration: 🟡 code exists, never run against the real API
Already built: structured-output JSON with Zod validation and error-feedback retries; deterministic blueprint and evidence checks (counts, type mix, true clues and red herrings, an alibi per innocent, briefing word count, hints never naming the culprit, confession regex); media with placeholders and a >30% failure cutoff; a blind-detective validator; up to 3 full attempts; cost logging; safety screen (denylist plus Gemini classifier); safety settings; seed wrapped in `<user_seed>`.

Gaps and risks:
1. **Evidence items are generated independently.** Each prompt sees only the title, setting and cast. It does **not** see the hidden timeline or the other evidence items, so cross-item timestamp and location consistency (fairness rule 5) is left to chance.
2. **The `clueMap` doesn't plan evidence *types*.** FR-11 (≥2 chat, ≥2 image, ≥1 CCTV, ≥1 document) is only checked *after* all 8–14 evidence calls, so a miss throws away the whole batch. This will drive up retries and cost.
3. **Image volume.** Each case needs 4–6 portraits, ≥2 photos, and 3–6 CCTV frames per CCTV item: roughly **12–20 image calls per case**. Free-tier image quotas will very likely fail cases. A flag to skip AI portraits and use stylised placeholders is recommended.
4. **Model names are unverified.** The defaults `gemini-3.8-flash` and `gemini-nano-banana-2.1` need to be checked against Google's current model list before M4 acceptance.
5. `retry()` deliberately does **not** retry 429s (spec NFR-03 says it should). This is a sensible choice for quota errors but isn't recorded in `DECISIONS.md`.
6. The safety screen calls Gemini **inside the job**, after the case already counts against the daily limit.
7. **Acceptance not met:** "5 consecutive real generations across difficulties" has never been run.

### M5 Case Board & evidence viewers: ❌ not started
Missing: `GET /api/cases/:id`, **the `toPlayerView` / `toResolvedView` DTO mappers**, the spoiler-leak test, API-14/15/16/17 (notes, suspect tags, viewed, hints), all six viewers (Chat, Image, CCTV, Document, CallLog, Email), notebook, hints panel, tabbed mobile layout and three-column desktop layout. The client has only a "Case file ready" placeholder.

### M6 Accusation, verdict, history, sharing: ❌ not started
Missing: `scoring.service.ts`, API-11/12/18/19/20/21, the verdict page, My Cases (currently a welcome card), delete with file cleanup, and public share.

### M7 Polish & hardening: ❌ not started
Missing: accessibility pass, loading/empty/error/offline states, rate limits and helmet (S-2), README, Dockerfile + compose, Playwright E2E smoke, Lighthouse check.

---

## 4. Configuration issues

| File | Issue |
|---|---|
| `server/.env.example` | Live credentials (S-1) |
| `server/.env.example` | `CLIENT_ORIGIN=http://localhost:5174`, but Vite runs on **5173**, so CORS and cookies break if this example is copied as-is |
| `server/.env.example` | `MAX_GENERATIONS_PER_DAY_GUEST=10`; the spec says **3** (code default is 3) |
| `client/vite.config.ts` | No dev proxy: the client calls `localhost:5000` cross-origin. Works with CORS, but SameSite cookies need care in production |
| root | `spec.md`, not `SPEC.md` as §5 says (cosmetic, keep as is) |

---

## 5. Test coverage vs spec §18

| Required | Present |
|---|---|
| Scoring unit tests | ❌ (no scoring service) |
| DTO mapper / **spoiler-leak** test | ❌ (highest-priority invariant, §15.1) |
| Zod schema tests | 🟡 enums and health only |
| Validator deterministic checks | 🟡 indirectly via orchestration tests |
| Prompt builders | ✅ |
| Orchestration: success / bad JSON retry / validator regen / placeholder / >30% fail | ✅ |
| API: auth flows | 🟡 |
| API: create limits (429), status polling | ✅ |
| API: accuse / hints / cross-user ownership of cases | ❌ (media ownership ✅) |
| E2E Playwright smoke | ❌ |

All existing tests mock Mongoose. None run against a real database.

---

## 6. Your brief vs `spec.md`: conflicts that need a decision

`spec.md` says it wins on conflicts. These items in your brief go beyond or against it:

| Your brief | Spec position | Recommendation |
|---|---|---|
| **AI suspect interrogation** | §22 lists it as **out of scope for v1** | Add it as **optional M8** after M1–M7, recorded in `DECISIONS.md`. The server would role-play from each suspect's profile and secret, never confess, be rate-limited, and have answers leak-checked. |
| **Context-aware hints** | FR-20: 3 hints pre-generated at blueprint time, never naming the culprit | Keep the pre-generated hints (deterministic and leak-safe). Optionally *order* them by which evidence is still unviewed, which needs no extra AI call. |
| **AI accusation evaluation** | FR-22/23: server compares the suspect ID; reasoning is optional and only stored | Keep the deterministic verdict. Optionally add AI feedback on the player's reasoning, **after** the case is resolved only. |
| Investigation timeline, progress indicators | Not explicit, but compatible | Build them client-side from player-visible `occurredAt` and viewed state only (no hidden timeline). |
| "Don't skip milestones" | M4 acceptance needs 5 real generations | M5–M6 can be built and tested in `MOCK_GEMINI` mode while M4 waits for an API key. I'll record this in `DECISIONS.md` if you agree. |

---

## 7. Proposed roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **A: Hygiene & foundation gaps** | S-1 placeholder, config fixes, local MongoDB setup, client `.env.example`, `CaseStatusSchema` fix, FR-03 upgrade bug, JSON-parse 400, fail-fast DB, helmet + rate limits + mongo-sanitize, Prettier, GitHub Actions CI, README v1 | `npm run dev` runs end-to-end in mock mode against real MongoDB: guest → create case → `ready`. All tests green, including new ones. |
| **B: M4 hardening** | Plan evidence types in `clueMap`, pass the hidden timeline into evidence prompts, portraits flag, verify model names, regenerate endpoint, record the 429 decision | 5 real generations across difficulties reach `ready` (needs your API key) |
| **C: M5 Case Board** | DTO mappers + spoiler-leak test, `GET /:id`, API-14–17, six viewers, notebook, tags, hints, timeline, responsive board | Leak test passes; all viewers render on mobile and desktop |
| **D: M6 Endgame** | Scoring + unit tests, accuse / reveal / verdict, My Cases, delete, share | Full playthrough works; scoring tests pass |
| **E: M7 Polish** | Design pass (fonts, motion, landing), accessibility, all loading/error/offline states, Docker, Playwright E2E | Lighthouse ≥ 85 mobile; README < 10 min setup |
| **F: M8 (optional)** | Suspect interrogation | Only if you approve the spec deviation |

## 8. First milestone: Phase A

It's small, unblocks everything else, and fixes the security issue and two bugs that would corrupt data later (guest case deletion, `/status` 500s).

**Needed from you before Phase A:**
1. Rotate the Atlas password (S-1). Only you can do this.
2. Pick a database for development: **local MongoDB via Homebrew** (lightweight, recommended) or **MongoDB Atlas M0** with new credentials kept only in `server/.env`.
3. Whether you have a Gemini API key, and which tier. Only Phase B needs it.
4. A decision on interrogation (§6).
