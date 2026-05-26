# Autonomous Kubernetes Actions

SignalForge supports a narrow autonomous action loop for Kubernetes Sources.

This is not a general remediation engine. SignalForge does not accept arbitrary shell commands, arbitrary YAML, or LLM-generated fixes. The deterministic policy gate decides whether an action can be queued.

## What Can Execute

The first supported policy is:

```text
kubernetes.disable-service-account-token-automount.v1
```

It maps the deterministic finding `Workload automatically mounts service account tokens` to a server-side apply patch template for the exact workload identified in deterministic JSON evidence. The persisted action payload contains the policy id, workload kind/name/namespace, optional kubectl context, manifest patch, and changed fields.

The current patch sets:

```text
spec.template.spec.automountServiceAccountToken=false
```

## What Cannot Execute

The first slice does not allow:

- Linux host fixes
- container runtime host fixes
- arbitrary shell commands
- arbitrary Kubernetes manifests
- RBAC deletion or rebinding
- Service or ingress exposure changes
- scaling, restarts, or rollout commands
- LLM-authored patches

## Required Source Settings

The Source must have:

- `expected_artifact_type: "kubernetes-bundle"`
- `automation_enabled: true`
- `auto_fix_enabled: true`
- `allowed_fix_policy_ids` containing the selected policy id
- Source capabilities containing `fix:kubernetes-safe`

The execution agent must also heartbeat with:

```json
{
  "capabilities": ["collect:kubernetes-bundle", "fix:kubernetes-safe"]
}
```

## Audit Trail

Every action is linked to:

- the automation signal
- the diagnostic collection job
- the pre-fix run
- the deterministic finding
- the policy id
- dry-run evidence
- apply evidence
- the post-fix collection job and run

SignalForge marks an action `verified` only when post-fix evidence no longer contains the triggering finding.

## Rollback Expectations

Rollback stays outside the first autonomous action slice. Operators should use their normal Kubernetes delivery path, GitOps history, or workload manifests to revert a change. SignalForge records what was dry-run and applied so that the operator has an audit trail.
