# Phase 9b Design: Operational Diagnostics Enrichment and Rich Presentation

> Status: in progress. The first presentation slice is already in this branch: dashboard `Collection Pulse` and run-detail findings overview/filtering. The richer diagnostics collection work remains a follow-on across `signalforge`, `signalforge-agent`, and `signalforge-collectors`.

## Why this exists

SignalForge now has three useful artifact families:

- `linux-audit-log`
- `container-diagnostics`
- `kubernetes-bundle`

But the current branch reality is uneven:

- Linux host evidence includes some operational data such as memory, processes, disk, and recent errors
- container and Kubernetes evidence are much more posture-oriented than runtime-diagnostics-oriented
- the UI still treats findings as the dominant output, which means even useful evidence can stay visually buried

That is acceptable for the first security and posture slices, but it is not enough for a strong operator diagnostics product.

This plan exists so the next evidence additions and the UI work to surface them are tracked together.

## Already implemented on this branch

The presentation half has started:

- dashboard `Collection Pulse` replaced the low-value `Environment Mix` card with a 42-day collection heatmap plus elevated-day overlays
- run detail now has a findings overview band above the findings table
- findings can be filtered by operator-facing signal buckets and severity without hiding the underlying evidence trail

The evidence-enrichment half is still pending:

- richer Kubernetes operational diagnostics
- richer container runtime-health diagnostics
- richer Linux pressure diagnostics

## Problem statement

Today SignalForge is strongest at:

- exposure and hardening posture
- RBAC and identity risk
- host-escape style settings
- deterministic compare and drift

It is weaker at:

- resource pressure and saturation
- restart and health instability context
- rollout and node-condition context
- bounded runtime evidence that explains why a workload is unhealthy
- showing this evidence in the dashboard and findings experience without forcing operators to read raw blobs

If we add richer diagnostics without UI changes, the product hides too much value.

If we add UI richness without expanding evidence, the product becomes decorative instead of useful.

Both halves must move together.

## Current evidence baseline

### Linux host

Current collector coverage:

- system identity
- network interfaces, routes, and listeners
- users, groups, sudo, SSH config
- firewall posture
- installed packages and pending upgrades
- disk usage and inodes
- memory usage and swap
- running services
- top processes by memory
- recent syslog, journal, and auth errors

Current analysis strength:

- disk pressure
- package drift and pending updates
- exposed listeners
- SSH posture
- auth and error findings

### Container

Current collector coverage:

- runtime and container identity
- image
- published ports
- privileged mode
- host network and host PID
- added capabilities
- privilege-escalation posture
- mounts, writable mounts, and host-path style mounts
- read-only root filesystem posture
- mounted secrets
- root user posture

Current analysis strength:

- exposure and privilege posture
- runtime isolation gaps
- secret and socket mounts
- image immutability hygiene

### Kubernetes

Current collector coverage:

- external Service exposure
- NetworkPolicy presence
- RBAC bindings
- RBAC roles
- workload specs
- workload status summarized from Pods

Current analysis strength:

- externally exposed services
- namespace isolation gaps
- risky RBAC and service-account joins
- CrashLoopBackOff
- token automount and default service account usage
- host namespace sharing
- privileged containers
- writable root filesystems
- missing probes
- missing resource requests and limits
- secret env and secret volumes
- projected service-account tokens
- hostPath mounts
- added capabilities
- privileged init containers

## Recommended next evidence tranche

This should be implemented as bounded, structured, mostly read-only evidence. Do not turn SignalForge into a generic observability scraper or broad live-debug shell.

### 1. Kubernetes operational diagnostics

Highest-value next slice.

Add optional bundle documents for:

- recent namespace or cluster events
- `kubectl top pod` and `kubectl top node` when metrics are available
- node conditions, taints, allocatable, and pressure state
- rollout status and replica mismatch for Deployments, StatefulSets, and DaemonSets
- HPA state
- PDB state
- ResourceQuota and LimitRange
- PVC and PV state
- ingress or gateway exposure surfaces

Optional bounded runtime evidence:

- small recent log excerpts only for non-ready, CrashLooping, or repeatedly restarting workloads

### 2. Container runtime-health diagnostics

Second-highest-value slice.

Add optional evidence for:

- container state and health status
- restart count
- OOMKilled and exit reason
- resource limits and reservations if available
- one-shot runtime stats such as CPU and memory
- bounded recent log excerpt for unhealthy containers

### 3. Linux pressure diagnostics

Useful, but after the Kubernetes slice.

Add:

- load average and basic CPU pressure
- top CPU processes
- OOM and kernel pressure signals
- simple I/O pressure or latency signals where available

## UI and presentation requirements

The frontend work is part of this plan, not optional polish.

### Findings page

The findings page should become richer and more dynamic without turning into chart clutter.

Required direction:

- keep the findings table as the core operator surface
- add evidence-aware summary blocks above it
- surface operational state separately from pure security posture
- make it obvious when a run shows pressure, instability, or rollout trouble even if the deterministic findings count is unchanged

Recommended additions:

- top summary strip for instability, exposure, pressure, identity, and hardening posture
- per-family evidence summary cards
- richer evidence snippets for findings that already have structured backing
- quick filters for posture, runtime health, exposure, identity, and resource pressure

### Dashboard enrichment

The current dashboard cards should not stay static if the collection plane gets richer.

The current `Environment Mix` area is a good candidate for replacement or expansion.

Recommended replacement:

- a **Collection Pulse** or **Fleet Pulse** heatmap inspired by a contribution chart
- one cell per day
- intensity based on collection activity or healthy agent heartbeats
- optional overlays or side summaries for:
  - runs collected
  - active sources
  - sources online vs stale
  - high-severity or high-instability days

Important UI constraint:

- do not use severity colors for generic activity
- use neutral palette for collection density
- reserve severity colors for actual risk or failure overlays

This should feel operator-useful, not like dashboard filler.

## Cross-repo requirements

This plan touches all three repos:

### `signalforge-collectors`

- extend collectors to gather the new bounded diagnostics
- keep outputs structured and stable
- document optional vs required surfaces clearly

### `signalforge-agent`

- pass through the richer collection scope where needed
- support optional collection flags without forcing every environment to have every capability
- keep failures explicit when optional diagnostics are unavailable

### `signalforge`

- extend adapters and deterministic findings only where evidence is strong enough
- keep new documents optional and family-aware
- update compare and evidence delta where the new metrics are stable enough
- enrich dashboard and run detail so new evidence is visible and useful

## Definition of done

This tranche is done only when all of the following are true:

- at least one new operational diagnostics slice is implemented end to end
- the added evidence is documented in a checked-in plan and collector README
- the SignalForge UI surfaces the added value instead of burying it in raw JSON or finding evidence strings
- compare remains deterministic and useful
- the dashboard communicates collection activity and posture or instability trends without becoming chart-heavy noise

## Recommended execution order

1. Finish the current Phase 9 scoped-collection contract across all three repos.
2. Implement Kubernetes operational diagnostics as the first enrichment slice.
3. Add findings and evidence surfacing to run detail and findings presentation.
4. Replace or expand the dashboard `Environment Mix` card with a useful activity and posture widget.
5. Add container runtime-health diagnostics as the next slice.
