# Sources And Agents

This document is the operator-facing view of the Source and collection-job model in SignalForge.

If you are deploying an agent for the first time, the preferred path is:

1. create a Source in `/sources`
2. enroll a source-bound agent token
3. install `signalforge-agent` as a long-lived service near the target surface
4. queue jobs from SignalForge

For Linux host collection, that preferred service path is a `systemd` service on the target VM. The detailed install steps live in [`../agent-deployment.md`](../agent-deployment.md).

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
- `/api/sources/{id}/collection-jobs`
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
2. Enroll an agent for that Source and save the source-bound token.
3. Prepare the execution environment with the required local dependencies and repo checkouts.
4. Run `signalforge-agent` as a long-lived service near the target surface.
5. Verify that the Source shows a recent heartbeat before queuing work.
6. Request collection from the Sources UI or `POST /api/sources/{id}/collection-jobs`.
7. The agent heartbeats, polls `jobs/next`, and receives a queued job with resolved `collection_scope`.
8. The agent claims and starts the job, runs the appropriate collector, and uploads the artifact.
9. SignalForge analyzes the artifact and links the resulting run back to the job.

## Minimum Operator Prerequisites

For the normal long-lived service path, make sure the execution environment has:

- network reachability to the SignalForge URL
- a `signalforge-agent` checkout
- a `signalforge-collectors` checkout
- the local runtime needed for that environment
- Linux host path: `bun`, `systemd`, and `sudo`
- container path: Docker or Podman access for the runtime user
- Kubernetes path: `kubectl`, kubeconfig or cluster identity, and the required RBAC

If those prerequisites are missing, treat that as environment preparation work, not a SignalForge job bug.

## Two Common Operator Mistakes

- enrolling an agent token, but never actually starting the long-lived service
- assuming the agent can collect evidence without the sibling `signalforge-collectors` repo on the same execution surface

SignalForge queues work and stores results. The agent still needs the local collector scripts and local runtime access.

## What Operators Should Look At

In the Sources UI, operators should be able to inspect:

- the Source identity
- the execution surface, meaning where the long-lived agent runs
- the expected artifact family and typed collection scope, meaning what evidence the agent will collect
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
