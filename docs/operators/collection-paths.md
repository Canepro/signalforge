# Collection Paths

This document records the honest collection story by environment.

SignalForge accepts evidence in two ways:

- **push-first**: a script or helper produces an artifact and submits it directly to `POST /api/runs`
- **job-driven**: SignalForge queues a collection job and `signalforge-agent` picks it up from the target-side execution environment

Neither path turns SignalForge itself into a privileged execution engine.

When reading the rest of this document, keep the split explicit:

- execution surface = where the long-lived agent runs
- evidence target = what the artifact family and collection scope describe

## Current Recommendation By Environment

| Environment | Recommended path | Why |
|---|---|---|
| Linux / WSL host | Preferred: job-driven host service. Easiest: push-first. | Host audit is the cleanest end-to-end job-driven slice, but direct push remains a low-friction fallback. |
| Container runtime host | Preferred: runtime-host agent service or containerized runner. Easiest: push-first. | The best long-running form keeps the agent near the real Docker or Podman socket, but direct push is still the fastest way to start. |
| Kubernetes | Preferred: cluster-side agent deployment. Easiest: push-first. | The durable job-driven form is a dedicated cluster-side deployment; workstation or CI push stays the simplest entry path when kubeconfig and RBAC already exist. |

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

- preferred long-running path: runtime-host `systemd` service or a containerized runner on the runtime host
- easiest start: push-first with `signalforge-collectors`
- job-driven requires deliberate Docker or Podman access on the execution host
- treat runtime-socket access as a higher-trust deployment form

### Kubernetes bundle

- preferred long-running path: cluster-side Kubernetes Deployment
- easiest start: push-first from a workstation, bastion, or CI runner with the intended kubeconfig and RBAC
- job-driven can work when the execution environment has the intended kubeconfig and RBAC
- prefer cluster-side or cluster-adjacent execution over a human workstation session

## Related Docs

- control-plane lifecycle: [`sources-and-agents.md`](./sources-and-agents.md)
- typed scope model: [`job-scoped-collection.md`](./job-scoped-collection.md)
- deployment and security baseline: [`../agent-deployment.md`](../agent-deployment.md)
