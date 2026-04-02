# SignalForge Agent Deployment Guidance

This document is the operator-first setup guide for the external execution-plane agent, `signalforge-agent`.

If you are deploying the agent for Linux host collection, the preferred path is a long-lived `systemd` service on the target host. Start there unless you have a specific reason not to.

## Preferred Deployment

The preferred deployment model is:

- one `signalforge-agent` product
- running as a long-lived service
- deployed near the execution surface
- managed by the local init or platform, not by an operator shell session

The preferred long-running form is environment-specific:

- Linux and WSL host audit: hardened `systemd` service on the target host
- container diagnostics: long-running runtime-host service or containerized runner on the runtime host
- Kubernetes bundle collection: dedicated cluster-side Deployment with explicit kubeconfig or future in-cluster identity

## Linux Host Quickstart

Use this path for the common operator workflow: create a Source in SignalForge, enroll the agent, install the service on the VM, and let SignalForge queue jobs to it.

### Prerequisites

On the target Linux VM, you need:

- `git`
- `bun`
- `systemd`
- `sudo`
- network reachability to the SignalForge URL
- a checkout of `signalforge-agent`
- a checkout of `signalforge-collectors`
- a Source already created in SignalForge
- a source-bound agent token from **Enroll agent** in `/sources`

Example repo layout:

```bash
cd ~
git clone https://github.com/Canepro/signalforge-agent.git
git clone https://github.com/Canepro/signalforge-collectors.git
cd ~/signalforge-agent
bun install
```

### Install The Service

Create the local service config files:

```bash
cd ~/signalforge-agent
cp contrib/systemd/signalforge-agent.env.example contrib/systemd/signalforge-agent.env
cp contrib/systemd/signalforge-agent.token.example contrib/systemd/signalforge-agent.token
chmod 600 contrib/systemd/signalforge-agent.token
mkdir -p ~/signalforge-agent/work
```

Edit `contrib/systemd/signalforge-agent.env` and replace the placeholder values before running preflight:

```dotenv
SIGNALFORGE_BASE_URL=https://signalforge.example.com
SIGNALFORGE_AGENT_INSTANCE_ID=linux-vm-01-agent-1
SIGNALFORGE_COLLECTORS_DIR=/home/<user>/signalforge-collectors
SIGNALFORGE_AGENT_WORKDIR=/home/<user>/signalforge-agent/work
```

Paste the enrolled source-bound token into `contrib/systemd/signalforge-agent.token`.

### Run Manual Preflight

The manual `preflight` command reads exported shell environment, not the env file by itself. Source the env file first, then point the agent at the token file:

```bash
cd ~/signalforge-agent
set -a
source contrib/systemd/signalforge-agent.env
export SIGNALFORGE_AGENT_TOKEN_FILE="$PWD/contrib/systemd/signalforge-agent.token"
set +a

bun run src/cli.ts preflight
```

For a Linux host source, the important success signal is an effective capability set that includes:

- `collect:linux-audit-log`
- `upload:multipart`

Warnings about missing Docker, Podman, or `kubectl` are expected if this VM is only intended to collect Linux host evidence.

### Install And Start The Long-Lived Service

Install the preferred system service:

```bash
sudo ./scripts/install-systemd-service.sh --scope system --bun /home/<user>/.bun/bin/bun
```

Then verify that it is running:

```bash
sudo systemctl status signalforge-agent
sudo journalctl -u signalforge-agent -f
```

Expected behavior:

- the service starts and enters the poll loop
- the Source page stops showing `Unknown`
- `Last seen` appears in the Source UI
- after you queue a job, the logs show claim, start, collect, and upload

### Runtime User Note

The system installer runs the service as the invoking sudo user by default.

That is often a reasonable default for a first host install, but it can limit Linux audit coverage because `first-audit.sh` collects less data when it is not running as root. If you need fuller host-level collection, choose the runtime user intentionally and validate the resulting access model instead of assuming the default is equivalent to root.

## Scope

This guidance is for the external agent that:

- heartbeats to SignalForge
- polls `GET /api/agent/jobs/next`
- claims jobs
- runs collectors from `signalforge-collectors`
- uploads artifacts back to SignalForge

It does not change the product boundary:

- SignalForge remains the control plane and analysis plane
- collectors remain external
- this repo does not turn into a privileged remote execution service

## Current Implementation Status

Current implementation status in the sibling `signalforge-agent` repo:

- the preferred Linux / WSL host-service path has a first-class hardened `systemd` unit
- the service install flow supports a separate root-controlled token file instead of keeping the bearer token in the installed env file
- `signalforge-agent preflight` validates config, token source, and locally runnable collector or runtime capabilities before enabling the unit
- the installer supports a dry-run render path so operators can inspect the unit, env file, and token target before touching `systemd`
- the service install flow supports an optional managed kubeconfig path for Kubernetes-capable runners, wired into the installed env file instead of relying on a mutable operator context
- the agent supports explicit `SIGNALFORGE_KUBECTL_BIN` and `SIGNALFORGE_KUBECONFIG` overrides so Kubernetes-capable services can pin both the binary and the kubeconfig path
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

Current honest recommendation:

- Linux: job-driven via long-running host `systemd` service
- container: job-driven via a long-running containerized runner on the runtime host, with explicit socket access and capability pinning
- Kubernetes: job-driven via a long-running cluster-side Deployment, with explicit kubeconfig today and scoped in-cluster identity later

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
