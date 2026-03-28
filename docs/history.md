# SignalForge History

This document records small but important repo and operator history that should not live only in chat threads, terminal scrollback, or personal memory.

Use it for:

- migration triggers
- validated rollout checkpoints
- production or staging decisions that materially affect future work
- cross-repo findings that explain why a plan exists

Do not use it as a full changelog. Keep entries short, factual, and decision-oriented.

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
