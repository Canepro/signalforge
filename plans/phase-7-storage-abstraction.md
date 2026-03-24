# Phase 7 — Storage Abstraction and Multi-Backend Persistence

This document defines the recommended path for making SignalForge storage backend-agnostic without locking the project to a single hosted database vendor.

It is a design and implementation plan, not a commitment to ship every backend at once.

## Why This Exists

SignalForge currently persists through `sql.js` and a local SQLite file.

That is a good default for:

- local development
- tests
- small self-hosted installs
- zero-dependency first run

It is not a good production fit for serverless deployment targets such as Vercel because local filesystem state is ephemeral and not shared across instances.

The project should not solve that by hard-wiring itself to one hosted vendor.

The correct move is to:

1. define a stable persistence boundary
2. keep SQLite as a first-class local/self-hosted option
3. support at least one production-grade networked backend
4. allow future backend choice without changing the product surface

## Goals

- keep SignalForge open-source-friendly and self-hostable
- avoid product-level lock-in to Neon, Turso, or any single managed service
- preserve local developer ergonomics
- support durable production deployment on serverless platforms
- isolate backend-specific code from routes, pages, and domain logic
- make state transitions around jobs, runs, artifacts, and sources transaction-safe

## Non-Goals

- replacing the product API contract
- redesigning the run/artifact/source/job domain model
- introducing an ORM because “ORM” sounds cleaner
- supporting every SQL backend immediately
- building a plugin marketplace for storage engines
- preserving raw `sql.js` `Database` access outside backend adapters

## Decision Summary

Recommended supported backend model:

- `sqlite` as the default local/self-hosted backend
- `postgres` as the recommended production/serverless backend
- optional `libsql` support as a SQLite-family hosted backend after the abstraction is proven

Recommended implementation order:

1. extract the storage boundary
2. move app code behind that boundary
3. keep the existing implementation as the `sqlite` adapter
4. add `postgres`
5. add `libsql` only if the maintenance burden remains justified

Reasoning:

- SQLite preserves the excellent local onboarding story required for open source
- Postgres is the strongest production fit for concurrency, durability, and serverless deployment
- libSQL is attractive for users who prefer SQLite semantics, but it should not define the abstraction

## Current Problems In The Codebase

The current repo is close to a repository pattern, but the storage engine still leaks into the rest of the app.

Current coupling points:

- `src/lib/db/client.ts` owns both storage lifecycle and SQLite/sql.js details
- repository modules accept `sql.js` `Database` directly
- routes and pages call `getDb()` directly
- tests mutate the raw database using `db.run(...)`
- migrations are embedded in the SQLite client bootstrap path

This creates three problems:

1. backend choice is not a wiring problem, it is a cross-cutting rewrite problem
2. transactional correctness depends on driver-specific behavior instead of an explicit contract
3. tests verify storage internals instead of stable behavior boundaries

## Target Architecture

SignalForge should use three persistence layers.

### 1. Domain-facing storage service

This is the only layer used by routes, pages, server actions, and app services.

It should expose use-case-shaped operations such as:

- create run from submitted artifact
- reanalyze existing artifact
- list runs
- get run detail
- compare baseline lookup inputs
- create source
- update source
- queue collection job
- claim/start/fail/submit collection job
- heartbeat update

This layer should not expose:

- raw SQL
- driver-specific types
- direct transaction objects to the app layer

### 2. Backend adapter

Each backend implements the same storage contract.

Initial adapters:

- `sqlite` adapter using the current sql.js-based implementation
- `postgres` adapter for serverless and production

Optional later adapter:

- `libsql`

### 3. Backend-specific schema + migration ownership

Each adapter owns how schema changes are applied, while the logical schema remains shared.

Suggested layout:

- `src/lib/storage/contract.ts`
- `src/lib/storage/index.ts`
- `src/lib/storage/sqlite/*`
- `src/lib/storage/postgres/*`
- `src/lib/storage/libsql/*` if added
- `migrations/sqlite/*`
- `migrations/postgres/*`
- `migrations/libsql/*` if added

## Contract Design Principles

The abstraction should be narrow, explicit, and driven by real product behavior.

Requirements:

- operations return typed domain data, not rows bound to one SQL driver
- write paths support atomic units of work
- the contract models expected conflicts explicitly
- time-sensitive state transitions do not depend on caller-side read-modify-write races
- backend selection is environment-driven and centralized

Avoid:

- a giant generic query builder interface
- exposing “run arbitrary SQL” above adapters
- designing for hypothetical NoSQL backends

## Transaction Requirements

This project already has transaction-sensitive flows.

The storage contract must support atomic handling for:

- artifact insert + run insert
- reanalyze run creation
- source creation with uniqueness enforcement
- collection job claim
- collection job start
- collection job fail
- collection job submit with linked artifact/run creation
- lease reaping

The contract should make these units explicit.

Recommended shape:

- backend exposes `withTransaction(...)`
- higher-level storage service owns the workflow
- adapters implement conflict-safe SQL for each backend

Do not leave these as ad hoc multi-call sequences in routes.

## Backend Recommendations

### SQLite

Role:

- default dev backend
- default beginner quickstart backend
- acceptable for single-node self-hosting

Strengths:

- zero external dependency
- excellent OSS onboarding story
- simple backup/export/import model

Constraints:

- not appropriate for Vercel/serverless durability
- weaker for concurrent control-plane workloads

### Postgres

Role:

- recommended production backend
- recommended Vercel/serverless backend

Strengths:

- durable remote storage
- strong concurrency semantics
- broad ecosystem support
- easiest story for future scale and hosting portability

Tradeoff:

- more migration effort than SQLite-family options

### libSQL

Role:

- optional hosted SQLite-family backend
- good fit for users who want SQLite semantics with managed hosting

Strengths:

- philosophically aligned with SQLite-first users
- smaller conceptual gap from current implementation

Tradeoff:

- should not be the only production answer
- may add meaningful maintenance overhead if supported alongside Postgres and SQLite

## Proposed Incremental Plan

### Step 1 — Stabilize the persistence contract

Add a new contract module that defines:

- domain object shapes returned to callers
- storage operations grouped by use case
- explicit conflict/result types for lifecycle operations
- transaction boundary API

Exit criteria:

- contract exists
- no behavior changes
- no backend switch yet

### Step 2 — Move app entry points off raw `getDb()`

Replace direct route/page/action dependency on `getDb()` and `saveDb()` with a storage service.

Targets include:

- `src/app/api/**`
- `src/app/page.tsx`
- `src/app/runs/**`
- `src/app/sources/**`

Exit criteria:

- app entry points depend on storage service only
- no direct `sql.js` imports outside SQLite adapter/tests intended for adapter coverage

### Step 3 — Re-home current sql.js code as the SQLite adapter

Treat the existing implementation as the first adapter, not the application database layer.

Move or reshape:

- `src/lib/db/client.ts`
- `src/lib/db/repository.ts`
- `src/lib/db/source-job-repository.ts`

Exit criteria:

- current behavior preserved
- SQLite remains the default backend
- existing tests still pass

### Step 4 — Split tests by behavior vs backend internals

Refactor tests into:

- storage-contract behavior tests
- adapter-specific tests
- route tests through the storage service

Minimize direct `db.run(...)` use outside adapter-focused tests.

Exit criteria:

- app behavior tests no longer require `sql.js` internals
- SQLite adapter still has direct persistence tests

### Step 5 — Introduce backend selection and config

Add centralized config such as:

- `DATABASE_DRIVER=sqlite|postgres|libsql`
- `DATABASE_URL=...`
- `DATABASE_PATH=...`

Exit criteria:

- backend selection is centralized
- startup wiring picks the adapter once
- docs explain each mode clearly

### Step 6 — Add Postgres adapter

Implement the same storage contract on Postgres.

Requirements:

- equivalent logical schema
- conflict-safe writes
- transaction-safe job lifecycle
- migration strategy
- test coverage against Postgres-specific behavior

Exit criteria:

- local or CI integration tests pass against Postgres
- Vercel deployment path is documented and valid

### Step 7 — Decide whether libSQL support is worth carrying

Only add `libsql` after:

- the abstraction is proven by SQLite + Postgres
- maintenance burden is understood
- there is actual contributor or user demand

Exit criteria:

- explicit decision record: implement now, defer, or reject

## Testing Strategy

Tests should move upward in abstraction as the backend boundary solidifies.

### Contract tests

Run the same behavioral suite against every supported backend:

- run creation
- reanalyze
- compare baseline lookup
- source uniqueness
- job lifecycle transitions
- lease expiry and reaping
- conflict handling

### Adapter tests

Backend-specific tests should verify:

- migrations
- transaction behavior
- backend-specific edge cases
- cleanup semantics after failed writes

### Route and UI tests

These should treat storage as an injected dependency or configured service.

They should not know whether the backend is SQLite or Postgres.

## Documentation Requirements

This work should ship with first-class docs, not as an implementation afterthought.

Required updates:

- `README.md`
- `docs/getting-started.md`
- `docs/README.md`
- deployment docs for Vercel
- backend configuration reference
- self-hosting guide for SQLite and Postgres

Recommended doc topics:

- choosing a backend
- tradeoffs by environment
- migration expectations
- backup/restore guidance
- local development defaults

## Risks

### Risk: abstraction becomes vague and over-generic

Mitigation:

- design around current use cases
- prefer explicit methods over “query” escape hatches

### Risk: transaction semantics drift across backends

Mitigation:

- define conflict/result behavior in contract tests
- implement lifecycle operations as atomic service methods

### Risk: OSS quickstart becomes worse

Mitigation:

- keep SQLite as the default local path
- do not require cloud infrastructure for first run

### Risk: maintenance burden from too many backends

Mitigation:

- support SQLite and Postgres first
- add libSQL only if justified by demand

## Recommended Near-Term Execution

The next credible implementation sequence is:

1. introduce the storage contract
2. move routes/pages/actions behind it
3. preserve SQLite behavior as the first adapter
4. add contract-driven tests
5. implement Postgres
6. decide on libSQL from real demand

This is the lowest-risk path that preserves open-source flexibility without pretending all databases are the same.

## Out Of Scope For This Phase

- multi-tenant auth model
- distributed job scheduler
- queue broker introduction
- collector execution inside SignalForge
- cross-region database topology
- analytics warehouse or OLAP path

## Success Criteria

Phase 7 is successful when:

- the app layer no longer imports `sql.js`
- SQLite remains the default local development path
- Postgres is supported for durable production deployment
- storage behavior is enforced by backend-agnostic contract tests
- documentation clearly explains backend choice and tradeoffs
- the project remains open-source-friendly and not vendor-locked
