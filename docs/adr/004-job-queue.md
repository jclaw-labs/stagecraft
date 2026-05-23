# ADR-004: Job Queue and Worker Model

## Status
Accepted

## Context
The platform must run long-running async tasks: site creation, AI-driven edits, validation pipelines, and integration operations. These cannot block HTTP request/response cycles.

## Decision
Use a **PostgreSQL-backed job queue** with an in-process worker for v1, designed for easy migration to a dedicated queue (BullMQ/Redis) later.

### Chosen: Postgres-backed queue (v1) with migration path
- Jobs are stored as rows in a `SiteJob` table with status tracking
- A polling worker process picks up queued jobs and executes them
- Simple, no additional infrastructure beyond the existing Postgres DB
- Job payloads and results stored as JSON columns
- Clear status lifecycle: `queued` → `running` → `completed` | `failed` | `awaiting_review` | `canceled`

### Migration path
- The job abstraction layer (`packages/queue`) defines interfaces, not implementations
- When load requires it, swap the Postgres poller for BullMQ + Redis without changing callers

### Rejected alternatives
- **BullMQ + Redis from day one**: Adds infrastructure complexity before it's needed
- **Cloud-native queues (SQS, Cloud Tasks)**: Vendor lock-in for v1; premature
- **Temporal/Inngest**: Powerful but heavy for initial scope

## Consequences
- Job table lives in the platform Prisma schema
- Worker runs as part of the Next.js app process in dev, can be separated in production
- Job execution is bounded by timeouts and retry limits
- The `packages/queue` package exports `enqueue()`, `dequeue()`, and job handler registration

---

## Revision history

**2026-05-03, PR #88 — `create_site` runs synchronously, not via the worker.** The polling worker model assumes a long-lived Node process: workers poll, mark a job `running`, execute the handler inline, then mark `completed`/`failed`. On Netlify Functions (where the platform deploys), each Lambda invocation freezes the container the moment its HTTP handler returns — any in-flight async chain in a "background" job gets abandoned, and the SiteJob row stays `running` forever. Smoke testing surfaced this with stuck `create_site` rows that no subsequent worker poll would pick up (workers only dequeue `queued` jobs).

Fix: `POST /api/sites` now `await`s `handleCreateSite` directly inside the request handler. The SiteJob row is still created (status starts at `running`, then updated to `completed`/`failed` with the result before the response returns) for audit and dashboard parity. Total request latency is ~5–10 s, which fits within Netlify's 10 s free-tier function timeout.

`create_site` is removed from the worker's handler map. Other handlers (`migrate_site`) stay on the queue; they're rare enough today that the same Lambda-freeze risk hasn't bitten, and migrating them off would need either a Netlify Scheduled Function or a dedicated worker container.

The migration path in this ADR (Postgres → BullMQ/Redis) still applies for handlers that genuinely need async semantics. The synchronous-in-request pattern is the right choice for a workflow whose result the user needs to see immediately anyway.
