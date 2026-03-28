# SignalForge History

This document is the running project log for SignalForge.

It exists to keep important history in the repo instead of leaving it scattered across:

- chat threads
- terminal scrollback
- PR comments
- personal memory

Use it as the durable narrative of the app's life cycle. It should capture meaningful points from early development through current operation, and it can later feed a cleaner changelog or release notes process.

## What Belongs Here

Record entries that would materially help a future maintainer understand:

- why a plan or migration started
- what changed in the product or operating model
- what was validated in a real environment
- what failed in a way that shaped future work
- what cross-repo decision or discovery changed the roadmap

Examples:

- product-shape changes
- storage and deployment shifts
- operator workflow additions
- real incident or migration triggers
- major validation checkpoints

## What Does Not Belong Here

This is not meant to be:

- a commit-by-commit changelog
- a duplicate of `plans/current-plan.md`
- a scratchpad for temporary debugging notes
- a dump of every small code change

## Entry Style

Keep entries:

- factual
- dated
- short enough to scan
- detailed enough to preserve the decision context

Prefer:

- one dated heading per meaningful checkpoint
- short subsections when one day includes multiple related facts
- explicit separation between confirmed facts and reconstruction when needed

## Relationship To Future Changelogs

Think of this file as the raw repo history log.

Later, changelogs can be distilled from it into a cleaner audience-specific format such as:

- release notes
- milestone summaries
- public changelogs
- operator-facing upgrade notes

## Backfill Stance

This file was introduced after important parts of the project already existed.

That means earlier history should be backfilled carefully from:

- `plans/`
- `README.md`
- shipped docs
- commit history
- validated cross-repo evidence

Do not invent earlier milestones just to make the timeline look complete.

## Log

## Before 2026-03-20: MVP product boundary and UI direction

Backfilled from historical planning docs:

- [`plans/mvp.md`](../plans/mvp.md)
- [`plans/phase-2-ui.md`](../plans/phase-2-ui.md)

What was already decided before the first implementation commits in this repo:

- SignalForge would be its own product repo, separate from `signalforge-collectors`
- the product would be an evidence-to-findings diagnostics platform, not a collector, chatbot, remediation engine, or generic admin shell
- the architecture would be deterministic-first, with one LLM explanation pass layered on top rather than model-led findings generation
- collection, reanalysis, and compare would stay separate concepts instead of collapsing into a vague "refresh" workflow
- the product would start with Linux or WSL audit logs while preserving an adapter model for later container and Kubernetes support
- the UI direction was locked early as operator-first, table-first, and light-theme, with evidence, findings, actions, and metadata foregrounded over AI-dashboard styling

Why it matters:

- these decisions explain a large amount of current shape that can otherwise look accidental
- later phases extended the product, but they mostly followed this early boundary rather than replacing it
- this is the earliest durable product intent preserved in the repo today

## 2026-03-20: project foundation and rename

Backfilled from early `main` commit history:

- `826bd4d` `Phase 1a: analyzer core with deterministic pipeline, LLM fallback, and fixture-driven tests`
- `ea14a5e` `Rename from surfacer to SignalForge (signalforge)`
- `187138b` `Phase 1b: SQLite persistence (sql.js) + API routes + 15 repository tests`

What changed:

- the project identity settled on `SignalForge`
- the first deterministic analyzer and fixture-driven test base landed
- the app gained its first persisted artifact and run model with SQLite and API routes

Why it matters:

- this is the point where SignalForge became a real evidence-to-findings application instead of only an idea or local prototype

## 2026-03-24: app contracts, sources, and production-style persistence

Backfilled from `main` commit history and shipped docs:

- `cdb0d17` `Publish run ingestion, compare, and automation contract`
- `432141b` `Add sources, collection jobs, and source-bound agent APIs`
- `e989f44` `Ship sources UI and collection workflow UX`
- `d98f0ea` `Phase 7: storage abstraction, Postgres backend, and Vercel deployment`
- `c743351` / `02c3164` `Add CI parity checks and Postgres migration policy`

What changed:

- SignalForge moved beyond upload-only analysis into a control-plane shape with Sources, collection jobs, and source-bound agent APIs
- the storage boundary was abstracted so SQLite could stay local while Postgres became the durable deployment backend
- CI started validating typecheck, tests, build, and Postgres parity with checked-in migration discipline

Why it matters:

- this established the current app boundary: SignalForge as analysis and control plane, with collection kept outside the app

## 2026-03-25 to 2026-03-26: multi-artifact expansion and scoped collection

Backfilled from `main`, `plans/current-plan.md`, and phase docs:

- `d63c620` `feat: add phase 8 container compare foundation`
- `7b8f673` `feat: add kubernetes bundle tracer bullet`
- `7ad09f8` `feat: deepen kubernetes analysis and compare`
- `3f46c1f` `feat: surface multi-artifact collection flows`
- `c47db8d` `feat: finish collection scope parity and validation`
- `ad5ea49` `Implement collection scopes across sources jobs and docs`

What changed:

- SignalForge expanded from `linux-audit-log` into `container-diagnostics` and `kubernetes-bundle`
- compare and deterministic evidence-delta work became multi-artifact aware
- Sources and jobs gained typed `collection_scope` so job intent could be explicit for Linux, containers, and Kubernetes

Why it matters:

- this is where SignalForge stopped being only a Linux-audit product and became a broader infrastructure diagnostics platform
- it also created the job-shape that later exposed the Vercel upload boundary as a real operational blocker

## 2026-03-27: operator workstation and deployment-matrix hardening

Backfilled from `main`, `plans/current-plan.md`, and shipped docs:

- `0b937a6` `feat: implement phase 9c operator workstation redesign`
- `16d3885` `docs: switch agent guidance to deployment matrix`
- `0ad0533`, `a0fe4e5`, `0b45b53`, `5dee6cd` deployment-hardening doc updates

What changed:

- the operator UI was reshaped into a more deliberate workstation-style experience across dashboard, run detail, compare, and Sources
- agent deployment guidance became environment-specific:
  - host `systemd` for `linux-audit-log`
  - container-host runner for `container-diagnostics`
  - cluster-side deployment for `kubernetes-bundle`

Why it matters:

- this locked the more realistic operating model that Phase 10 now needs to host properly
- it raised the bar from feature completeness toward real operator usability and deployment credibility

## 2026-03-28: ACA migration evidence and staging validation

### Vercel upload failure that justified Phase 10

The ACA migration was justified by a real agent-driven upload failure on the Vercel deployment boundary.

Confirmed evidence from the earlier thread:

- control-plane URL at the time: `https://signalforge-zeta.vercel.app`
- failing path: `POST /api/collection-jobs/<job-id>/artifact`
- artifact family: `linux-audit-log`
- failing status: `HTTP 413`
- failed host artifact size reported in-thread: `4.7M`
- the failure was observed more than once

Best reconstruction:

- the agent successfully collected the host artifact
- the multipart upload to the Vercel-backed SignalForge app failed with `413`
- that failure is consistent with the cited Vercel request-body limit of `4.5 MB`

Important nuance:

- on 2026-03-28, a smaller host artifact from the same machine at `168434` bytes uploaded successfully to both Vercel and ACA
- that later A/B does not invalidate the original migration rationale
- it only shows that the original blocker was size-sensitive, not that Vercel never failed

### ACA staging isolation and validation

The first ACA staging app was initially pointed at a shared Neon database, which was not an honest staging boundary.

That was corrected on 2026-03-28:

- created dedicated Neon database `signalforge_staging`
- applied checked-in Postgres migrations
- rotated the ACA `database-url` secret to the dedicated staging database
- restarted the active ACA revision

After the isolation fix, the following were validated successfully against the live ACA app:

- `GET /api/health`
- `GET /api/runs`
- direct `POST /api/runs`
- operator source creation
- agent registration
- heartbeat and capability gating
- host collection job claim, start, and artifact upload
- Kubernetes collection job claim, start, and artifact upload

Result:

- live ACA staging is a credible control-plane target for real host and Kubernetes job flows while still keeping Neon/Postgres for phase 1

### Remaining issue found during real host-agent cutover

While testing the real host agent on `MogahPC`, the local collector path produced a fresh audit log but `first-audit.sh` exited with code `141` under agent-driven execution.

What is confirmed:

- the agent collected a fresh host artifact on the machine
- the collector/agent path marked the job failed because of the collector exit code
- using the agent's `SIGNALFORGE_AGENT_ARTIFACT_FILE` override with that exact host-generated artifact successfully uploaded it to ACA and completed analysis

Implication:

- the remaining blocker on this machine is now in the collector or agent execution path, not ACA ingress
