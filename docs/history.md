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

### Historical collected_at repair for agent-submitted runs

On 2026-03-29, a real data-quality gap was closed for historical ACA staging runs.

What was happening:

- new agent uploads were fixed to infer `collected_at`
- older runs already in the database still had `collected_at = null`
- that made the run detail UI fall back to recorded time, which was operationally weaker than keeping a best-effort collection timestamp in the database

What changed:

- added a one-time backfill command: `bun run db:backfill:collected-at`
- backfill priority is:
  - embedded artifact timestamp where available, such as Kubernetes bundle `collected_at`
  - collector filename timestamp such as `server_audit_YYYYMMDD_HHMMSS.log`
  - `run.created_at` only for agent-produced rows with no better hint
- legacy direct uploads with no trustworthy signal are intentionally left unset

Live staging result:

- ran the backfill against the dedicated staging database `signalforge_staging`
- scanned `11` runs with `collected_at = null`
- repaired `10`
- skipped `1` direct-upload-style row with no trustworthy timestamp evidence

Verification examples after repair:

- Kubernetes run `0cc7a104-b3cc-42d7-83aa-35eb420a5829` now has `collected_at = 2026-03-29T00:18:15.000Z`
- host run `0ca5cbe6-01f2-471f-8a9e-a5613baa7fb9` now has `collected_at = 2026-03-29T00:11:55.000Z`

### End-of-day checkpoint

State at stop:

- the live ACA staging app remains the active non-production control-plane target
- `MogahPC` host `systemd` agent is now pointed at ACA staging and has completed a real host job end to end
- Podman-backed `container-diagnostics` and OKE-backed `kubernetes-bundle` were both validated successfully against ACA staging
- historical agent-submitted staging runs now carry best-effort `collected_at` values where trustworthy evidence existed

What is done:

- host, container, and Kubernetes artifact families have all been exercised against ACA staging with successful analysis completion
- the original Vercel `413` migration trigger is now documented in repo history with enough evidence to justify the ACA move
- collector output and host-agent execution were improved in the external `signalforge-collectors` repo during the same work window

What is not done yet:

- the container and Kubernetes agent paths were validated as one-shot runs, not yet as always-on long-lived deployments
- one historical direct-upload-style row still has no trustworthy collection timestamp evidence and remains intentionally unset
- the next real migration step is still to make the non-host agent forms durable, starting with the local Podman-backed container agent because it is the closest to the already-proven host `systemd` model

## 2026-03-30: durable local Podman container-agent service

The local `container-diagnostics` path moved from ad hoc one-shot validation into a durable workstation service shape.

What changed:

- reused the existing staging source `MogahPC Podman signalforge-pg`
- rotated its source-bound token for a clean durable runner
- created a dedicated user-scoped `systemd` unit:
  - `~/.config/systemd/user/signalforge-agent-container.service`
- created dedicated local credential and env files:
  - `~/.config/signalforge-agent-container/env`
  - `~/.config/signalforge-agent-container/token`
- kept the runner narrow-scoped to `collect:container-diagnostics,upload:multipart`

What was learned during rollout:

- the first user-unit attempt copied host-agent hardening that blocked rootless Podman namespace setup
- removing the blocking service restrictions was necessary on this machine
- `podman system migrate` was also required after Podman reported an internal pause or namespace error

Result:

- the user-scoped container agent now starts automatically in the active user `systemd` session
- it successfully claimed, started, collected, uploaded, and completed a real `container-diagnostics` job against ACA staging
- verified completed job:
  - job `5330b1fa-f8c1-46f7-a7fe-946881d6c028`
  - run `9e787140-df00-4227-9b96-bc3ccf430357`
  - artifact `b2299251-56f6-447c-b62f-672d8eccc694`

Important caveat:

- this is a user-scoped service, not yet a root-owned boot-persistent system service
- `loginctl show-user vincent` still reported `Linger=no`, so this is durable for the active workstation session but not yet the final always-on form
- the live ACA staging app also still appears to be on an older image than the latest repo fixes, because the newly completed run did not yet persist `collected_at` despite that logic existing on the branch

## 2026-03-30: root-owned Podman container-agent cutover

The temporary user-scoped Podman agent was replaced with the intended root-owned system service form.

What changed:

- installed `signalforge-agent-container.service` under `/etc/systemd/system`
- installed its copied runtime config under:
  - `/etc/signalforge-agent-container.env`
  - `/etc/signalforge-agent-container/token`
- used the new `runtime-host` installer profile from the external `signalforge-agent` repo so the service keeps the right runtime access without the stricter host-audit hardening that blocked rootless Podman earlier
- disabled and removed the temporary user-scoped fallback unit and its local credential files so only one durable container agent remains on this machine

Result:

- the root-owned service is enabled and active on `MogahPC`
- it successfully claimed, started, collected, uploaded, and completed a real `container-diagnostics` job against ACA staging
- verified completed job:
  - job `8a6a08b2-ba76-466e-94c7-5df7adf06a92`
  - run `894a058c-94a8-494c-8b28-3307be5f7dc3`
  - artifact `99be754a-2d5d-4828-a7a3-f09d038fdf4b`

Current state after cutover:

- the root-owned host audit agent remains the durable runner for `linux-audit-log`
- the root-owned container agent is now the durable runner for `container-diagnostics`
- the user-scoped container-agent bridge was only a migration aid and is no longer installed

## 2026-03-30: ACA staging redeployed to current branch image

The staging ACA app was rolled forward from the older `staging-8b65719` image to the current branch image so the live environment matched the branch fixes.

What changed:

- built and pushed `caneprophacr01.azurecr.io/signalforge:staging-79b7e81`
- updated `ca-signalforge-staging` to revision `ca-signalforge-staging--stg79b7e81`
- waited for the new revision to become the ready revision before running live checks

Result:

- `GET /api/health` stayed healthy after rollout
- a fresh ACA-driven `container-diagnostics` job completed successfully through the root-owned container agent
- verified completed job:
  - job `785c1fec-e5d1-4a4d-af52-3de5276f48dc`
  - run `d4799328-5a7a-4071-bd17-111004a12c28`
  - artifact `8dee8157-2fde-4f6e-b162-5914453cbdcc`
- the new run now carries a real `collected_at = 2026-03-30T17:23:47.363Z`, confirming the previously missing live staging behavior is now deployed

## 2026-03-30: durable OKE Kubernetes agent rollout completed

The Kubernetes runner moved from one-shot validation into a real cluster-side deployment shape.

What changed:

- built and published repeatable arm64 agent images from the `signalforge-agent` repo with ACR build
- standardized the product namespace to `signalforge` and removed the obsolete failed namespace `signalforge-agent-system`
- deployed the Kubernetes runner as a dedicated `Deployment` with:
  - dedicated `signalforge` namespace
  - dedicated service account
  - read-only cluster RBAC
  - in-cluster kubeconfig ConfigMap with `oke-cluster` alias
  - writable `/work` volume for collector output
- fixed the stale rollout mismatch where the live pod still lacked the newer writable workdir behavior
- documented the publish and deploy flow in the `signalforge-agent` repo so the rollout is repeatable instead of chat-only

What was learned during rollout:

- the early failed namespace was not a Kubernetes design problem, it was stale amd64 and pre-fix image state on arm64 OKE nodes
- cluster-side collection needed both:
  - a writable collector output directory
  - the actual latest image, not only the latest manifest
- rollout overlap can briefly let an old terminating pod claim a job; clean validation should happen only after the deployment settles to one live pod
- `POST /api/collection-jobs/{id}/artifact` can take materially longer for `kubernetes-bundle` than for host or container artifacts, because the route does not return until analysis work completes

Result:

- the settled Kubernetes runner in namespace `signalforge` successfully claimed, started, collected, uploaded, and completed a real cluster-scope `kubernetes-bundle` job against ACA staging
- verified completed job:
  - job `acb7e4ac-1fea-41bb-85c1-a83a93740277`
  - run `1ac91502-4fc7-4cd1-b2ce-0b94d0abd344`
  - artifact `c945788e-c1f6-4a46-8de2-e48a2ac8ef46`
- verified live image:
  - `caneprophacr01.azurecr.io/signalforge-agent:oke-arm64-20260330-203837`
  - digest `sha256:971f48a393f2a18c6500fcf962851142a423adceb6de1596b8b80b5047c618e1`

Current state after rollout:

- `linux-audit-log` has a durable host `systemd` runner
- `container-diagnostics` has a durable root-owned runtime-host runner
- `kubernetes-bundle` now has a durable cluster-side OKE runner
- ACA staging has now been validated end to end across all three current artifact families with real agent-driven flows

## 2026-03-30: UI-system decision and run-detail redesign brief

What changed:

- recorded the UI-system decision in [`docs/ui-system-direction.md`](./ui-system-direction.md)
- confirmed that SignalForge still does not use `shadcn/ui` today and should not do a blind migration from the current custom `sf-*` system
- added a focused run-detail redesign brief in [`plans/phase-9d-run-detail-operator-summary.md`](../plans/phase-9d-run-detail-operator-summary.md)

Why it matters:

- this captures the design decision in repo form instead of relying on chat memory
- it also narrows the next frontend problem from generic "make the findings tab better" into a concrete operator-summary redesign based on evidence the product already collects
- the brief explicitly keeps charts bounded to naturally quantitative evidence and keeps the findings table as the source of truth

## 2026-03-30: run-detail summary modules implemented on the ACA migration branch

What changed:

- replaced the run-detail-only evidence-card block with a dedicated artifact-aware summary-module layer
- moved run-detail summary assembly onto the server-side page-detail path so modules can use raw persisted artifact content without widening the public API contract
- added first-slice summary modules for:
  - shared run health and immediate next steps
  - Kubernetes capacity, top consumers, guardrails, and instability
  - container runtime health, resource snapshot, and guardrails
  - Linux host pressure and storage watch

Why it matters:

- the page can now tell a stronger operator story before the findings table
- quantitative signals such as node memory, node CPU, top pod consumers, container CPU or memory, and host disk usage can now be shown as compact bars instead of only text findings
- the new module contract gives future frontend work one reusable place to add richer artifact-aware summaries instead of layering more page-specific cards

## 2026-03-30: run-detail hierarchy consolidation after live operator review

What changed:

- removed the duplicate `Immediate Next Steps` module so `Top Actions` remains the single canonical recommendation surface
- added `primary` vs `supporting` prominence to run-detail summary modules so artifact-family lead signals can visually outrank secondary context
- reordered the page so artifact-aware operator summaries and findings filters appear before the narrative summary
- reduced the findings overview surface to counts and filters instead of a second synthesis pass
- collapsed the prose summary into an explicit `Analysis narrative` expander

Why it matters:

- the screen now opens with scan-friendly state instead of explanation, which is the right read path for an operator-first diagnostics product
- the most important quantitative module can now lead the page without fighting equally weighted secondary cards
- the page no longer repeats the same recommendation set in multiple places with different chrome

## 2026-03-30: run-detail spacing and density polish pass

What changed:

- tightened summary-module spacing and reduced low-signal helper copy in the summary and findings-filter surfaces
- replaced generic module count chips with operator-meaningful status labels such as `Needs action` and `Watch closely`
- made the top-actions strip denser and clearer so it reads more like a control surface and less like a banner

Why it matters:

- the screen now uses less vertical space to say the same thing
- the densified layout keeps more of the operator story above the fold without adding noise
- labels now communicate state instead of implementation detail
