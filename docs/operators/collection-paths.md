# Collection Paths

This document records the honest collection story by environment.

SignalForge accepts evidence in two ways:

- **push-first**: a script or helper produces an artifact and submits it directly to `POST /api/runs`
- **job-driven**: SignalForge queues a collection job and `signalforge-agent` picks it up from the target-side execution environment

Neither path turns SignalForge itself into a privileged execution engine.

## Current Recommendation By Environment

| Environment | Recommended path | Why |
|---|---|---|
| Linux / WSL host | Job-driven or push-first | The agent and collector path is cleanest here and maps directly to host audit collection |
| Container runtime host | Push-first for broad use; job-driven only when the runtime host is explicitly prepared | The typed scope contract is implemented, but collection still depends on deliberate local runtime access on the execution host |
| Kubernetes | Push-first for broad use; job-driven only when the execution environment has the intended kubeconfig and RBAC | The typed scope contract is implemented, but collection still depends on explicit kubeconfig or future in-cluster identity |

## Push-First

Use push-first when:

- you already have the artifact
- you are collecting from CI, a workstation, or an existing automation surface
- you want the simplest path with the least operational setup

Example:

```bash
git clone https://github.com/Canepro/signalforge-collectors.git
cd signalforge-collectors
./submit-to-signalforge.sh --file examples/sample_audit.log --url http://localhost:3000
```

For container and Kubernetes evidence, prefer explicit stable `target_identifier` values so compare stays meaningful across restarts and redeploys.

## Job-Driven

Use job-driven collection when:

- you want Sources to queue work from the UI or API
- you have a long-running execution surface near the target
- the local environment is prepared for the collector family it advertises

Normal operator model:

1. Create a Source.
2. Enroll an agent.
3. Run `signalforge-agent` as a long-running service near the target.
4. Request collection from `/sources`.

Preferred deployment posture:

- keep the agent warm for heartbeat and long-poll
- use a dedicated local service identity
- avoid operator laptops, mutable `kubectl current-context`, and shell-exported bearer tokens as the normal production path

Detailed deployment guidance: [`../agent-deployment.md`](../agent-deployment.md)

## Environment Notes

### Linux / WSL

- push-first is valid
- job-driven is also a clean operator path today
- preferred long-running form: hardened host `systemd` service

### Container diagnostics

- push-first is still the broadest honest default
- job-driven can work when the runtime host exposes the intended Docker or Podman access to the agent
- treat runtime-socket access as a higher-trust deployment form

### Kubernetes bundle

- push-first is still the broadest honest default
- job-driven can work when the execution environment has the intended kubeconfig and RBAC
- preferred long-running form is cluster-adjacent or cluster-side, not a human workstation session

## Related Docs

- control-plane lifecycle: [`sources-and-agents.md`](./sources-and-agents.md)
- typed scope model: [`job-scoped-collection.md`](./job-scoped-collection.md)
- deployment and security baseline: [`../agent-deployment.md`](../agent-deployment.md)
