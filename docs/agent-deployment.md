# SignalForge Agent Deployment Guidance

This document records the preferred deployment model for the external execution-plane agent, `signalforge-agent`.

It exists to keep the product story, operator guidance, and Phase 9 work aligned.

## Scope

This is guidance for the external agent that:

- heartbeats to SignalForge
- polls `GET /api/agent/jobs/next`
- claims jobs
- runs collectors from `signalforge-collectors`
- uploads artifacts back to SignalForge

It does not change the product boundary:

- SignalForge remains the control plane and analysis plane
- collectors remain external
- this repo does not turn into a privileged remote execution service

## Preferred deployment model

The preferred deployment model is:

- one `signalforge-agent` product
- running as a long-lived service
- deployed near the execution surface
- managed by the local init or platform, not by an operator shell session

Today, that means:

- Linux and WSL: prefer a hardened `systemd` service on the target host
- container host environments: prefer the same host-service model on the runtime host, or a dedicated nearby runner with explicit runtime access
- Kubernetes: keep push-first as the honest default until Phase 9 scope handling is complete; once job-driven Kubernetes becomes first-class, prefer a dedicated cluster-side runner with explicit RBAC over operator laptops or ambient `kubectl`

Current implementation status in the sibling `signalforge-agent` repo:

- the preferred Linux / WSL host-service path now has a first-class hardened `systemd` unit
- the service install flow now supports a separate root-controlled token file instead of keeping the bearer token in the installed env file
- `signalforge-agent preflight` now validates config, token source, and locally runnable collector/runtime capabilities before enabling the unit
- the installer supports a dry-run render path so operators can inspect the unit, env file, and token target before touching `systemd`
- the service install flow now supports an optional managed kubeconfig path for Kubernetes-capable runners, wired into the installed env file instead of relying on a mutable operator context
- the agent now supports explicit `SIGNALFORGE_KUBECTL_BIN` and `SIGNALFORGE_KUBECONFIG` overrides so Kubernetes-capable services can pin both the binary and the kubeconfig path
- this service path has been smoke-tested under a real user `systemd` execution context via `systemd-run --user`, not only through static unit rendering
- container-capable readiness now requires actual Docker or Podman access during capability derivation and `preflight`, not only a runtime binary on `PATH`

## Why this is the preferred model

This model is preferred because it:

- keeps the agent warm for heartbeat and long-poll
- avoids cold-start timing and missed jobs
- keeps permissions close to the target instead of in SignalForge
- removes dependence on a human login session, terminal, or mutable shell environment
- is easier to audit and harden than laptop-driven or ad hoc execution

## Not the preferred model

These may be useful for smoke tests or debugging, but they are not the normal production story:

- operator laptops
- ad hoc `signalforge-agent once` as the default collection path
- cron wrappers as the primary deployment form
- generic bastions with changing local state
- Kubernetes collection that depends on whichever `kubectl` `current-context` is active for a human user

## Security baseline

### Token handling

- use the source-bound agent token only for that source
- load the token from a root-controlled file or service credential
- do not pass the token on the command line
- do not rely on a developer shell profile as the durable secret store

### Local identity

- use a dedicated local service account
- grant only the file, group, and socket access that host actually needs
- treat container-runtime access as a higher-trust host profile, not the default
- for Docker-capable hosts, validate daemon-socket reachability as that service account, not only `docker` binary presence
- for Podman-capable hosts, validate `podman info` in the intended rootless or privileged mode before advertising `container-diagnostics`

### Service hardening

For Linux and WSL, prefer `systemd` hardening such as:

- `NoNewPrivileges=yes`
- `PrivateTmp=yes`
- `ProtectSystem=strict`
- `ProtectHome=read-only` or a narrower file layout
- `CapabilityBoundingSet=` reduced to the minimum required set
- `RestrictAddressFamilies=` limited to the families actually needed

`DynamicUser=` can be a good fit when the host does not need stable group membership or fixed-path file access. It is not the safe default when the agent must read a kubeconfig, access a runtime socket, or join a local group such as `docker`.

### Kubernetes access

- prefer explicit kubeconfig path and explicit context selection, or a dedicated in-cluster identity later
- do not treat a mutable workstation kubeconfig as the normal production path
- when an in-cluster runner exists, use scoped RBAC and standard container hardening

## Honest current status

Current best path:

- Linux host job-driven collection is the cleanest fully general deployment path today
- that path now has a first-class hardened install and preflight flow in `signalforge-agent`

Current limited paths:

- `container-diagnostics` job-driven collection can work from a prepared host agent, but runtime access must be explicit
- `kubernetes-bundle` job-driven collection can work from a prepared host agent with explicit kubeconfig and context handling, but it is still not as operationally clean as the future dedicated cluster-side runner story

Current honest recommendation:

- Linux: job-driven via long-running host service
- container: push-first or carefully prepared host service
- Kubernetes: push-first first, then dedicated cluster-side runner once Phase 9 is complete

## Phase 9 relationship

Phase 9 is the slice that removes hidden per-job target state from the agent host environment.

It does not change the preferred deployment direction above. Instead, it makes that direction operationally credible by ensuring:

- queued jobs are self-describing
- the agent receives explicit typed scope
- collectors consume explicit typed inputs
- operators do not need to rely on ambient shell state or workstation context

Source of truth for the Phase 9 cross-repo slice:

- [`../plans/phase-9-job-scoped-collection-parameters.md`](../plans/phase-9-job-scoped-collection-parameters.md)

## Research basis

This guidance is aligned with official upstream documentation:

- [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
- [Kubernetes: Configure Access to Multiple Clusters](https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-multiple-clusters/)
- [Kubernetes: Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)
