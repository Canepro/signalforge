# Sources And Agents

This document is the operator-facing view of the Source and collection-job model in SignalForge.

## What Lives In SignalForge

SignalForge stores and exposes:

- Sources
- source-bound agent registrations
- queued, claimed, running, submitted, failed, cancelled, and expired collection jobs
- resolved typed `collection_scope` on queued jobs
- uploaded artifacts and resulting analysis runs

SignalForge does not run collectors on the host or in the cluster. That execution stays external.

## The Two Credentials

There are two distinct credentials in this model.

### Admin bootstrap token

Set `SIGNALFORGE_ADMIN_TOKEN` in SignalForge to enable:

- `/sources`
- `/api/sources`
- `/api/collection-jobs/*`
- `/api/agent/registrations`

The `/sources/login` page stores this value as an httpOnly session cookie. For raw HTTP, use `Authorization: Bearer <SIGNALFORGE_ADMIN_TOKEN>`.

### Source-bound agent token

Each enrolled agent receives a source-bound token from `POST /api/agent/registrations`.

That token is only for the execution-plane agent. It is used on:

- `POST /api/agent/heartbeat`
- `GET /api/agent/jobs/next`
- collection job `claim`, `start`, `fail`, and `artifact`

## Control Plane vs Execution Plane

The split is intentional:

- **SignalForge**: register Sources, queue jobs, analyze artifacts, present runs
- **signalforge-agent**: heartbeat, poll, claim, execute collectors locally, upload artifacts
- **signalforge-collectors**: collector scripts only

This keeps SignalForge from becoming a privileged SSH, `kubectl`, or runtime-execution service.

## Normal Lifecycle

1. Create a Source in `/sources`.
2. Enroll an agent for that Source.
3. Run `signalforge-agent` near the target surface.
4. Request collection from the Sources UI or `POST /api/sources/{id}/collection-jobs`.
5. The agent heartbeats, polls `jobs/next`, and receives a queued job with resolved `collection_scope`.
6. The agent claims and starts the job, runs the appropriate collector, and uploads the artifact.
7. SignalForge analyzes the artifact and links the resulting run back to the job.

## What Operators Should Look At

In the Sources UI, operators should be able to inspect:

- the Source identity and expected artifact family
- the stored default collection scope
- the resolved collection scope on queued jobs
- the agent enrollment state
- the recent job timeline and terminal status

If those fields do not explain what a queued job will collect, treat that as a product bug, not operator error.

## Honest Current State

- Linux host job-driven collection is still the cleanest operator path today.
- Container and Kubernetes jobs now carry explicit typed scope in SignalForge, and the sibling agent and collector repos honor that scope contract.
- The remaining non-Linux limitations are deployment-specific: the execution environment still needs the intended runtime access, kubeconfig, and RBAC, plus production-like validation on the real host or cluster surface.

For the environment-by-environment collection guidance, continue with [`collection-paths.md`](./collection-paths.md).
