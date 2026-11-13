# Implementation decisions

## M1 Foundation

- **DEC-001 — Mongo health behavior:** `/api/health` always responds with process health and reports MongoDB connection state separately. This keeps the endpoint useful while a local database is starting.
- **DEC-002 — Frontend theme:** The initial shell uses a responsive dark case-file theme that can be extended during later gameplay milestones.
- **DEC-003 — Milestone scope:** Work follows `spec.md` Section 20; later milestone features are intentionally not scaffolded as functional flows before earlier acceptance criteria are met.
- **DEC-004 — Optional object storage:** M4 implements the storage interface and local driver. S3 remains optional and deferred; configuring `STORAGE_DRIVER=s3` fails clearly until its driver is added.
