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
