# Operator Docs

Use this section when you are running SignalForge as an operator rather than just trying a first local upload.

This is where Sources, collection jobs, agent enrollment, environment-specific collection guidance, and the typed `collection_scope` model now live.

One important vocabulary rule for operators:

- execution surface = where the long-lived agent runs
- artifact family + collection scope = what evidence that agent will collect

## Recommended Reading Path

1. [`sources-and-agents.md`](./sources-and-agents.md)
2. [`automation-agent-integration.md`](./automation-agent-integration.md)
3. [`autonomous-kubernetes-actions.md`](./autonomous-kubernetes-actions.md)
4. [`collection-paths.md`](./collection-paths.md)
5. [`job-scoped-collection.md`](./job-scoped-collection.md)
6. [`../agent-deployment.md`](../agent-deployment.md)

For automation-agent multi-source setup: [`source-inventory-map.md`](./source-inventory-map.md) →
[`automation-agent-multi-source-enrollment.md`](./automation-agent-multi-source-enrollment.md) →
[`automation-agent-source-wrappers.md`](./automation-agent-source-wrappers.md)

## Documents

| Document | Use it for |
|---|---|
| [`sources-and-agents.md`](./sources-and-agents.md) | Sources UI, agent enrollment, collection-job lifecycle, and the control-plane / execution-plane split |
| [`automation-agent-integration.md`](./automation-agent-integration.md) | How external AI agents, including OpenClaw/Hermes-style operator systems, connect over HTTP, bootstrap source-bound tokens, and request diagnostics safely |
| [`autonomous-kubernetes-actions.md`](./autonomous-kubernetes-actions.md) | Opt-in Kubernetes automation signals, safe-fix policies, dry-run/apply evidence, and post-fix verification |
| [`collection-paths.md`](./collection-paths.md) | Honest push-first vs job-driven guidance by environment |
| [`job-scoped-collection.md`](./job-scoped-collection.md) | Typed collection-scope defaults and overrides, what SignalForge stores today, and what still depends on sibling repos |
| [`source-inventory-map.md`](./source-inventory-map.md) | Canonical operator map of every planned and enrolled diagnostic Source: target identifier, artifact family, credential store, automation-agent access, and safe-fix policy |
| [`automation-agent-multi-source-enrollment.md`](./automation-agent-multi-source-enrollment.md) | Per-source automation-agent token naming, host file paths, Infisical secret names, enrollment steps, and discovery model |
| [`automation-agent-source-wrappers.md`](./automation-agent-source-wrappers.md) | Per-source wrapper contract: naming convention, interface, token file, and health check |
| [`automation-agent-wrapper-deployment-checklist.md`](./automation-agent-wrapper-deployment-checklist.md) | Deployment checklists, rollback procedures, and operator verification report template |
| [`automation-agent-codex-app-server-integration.md`](./automation-agent-codex-app-server-integration.md) | Automation-agent vs Codex App Server analysis-brain role separation |
| [`codex-brain-artifact-quality-pass.md`](./codex-brain-artifact-quality-pass.md) | Codex analysis-brain quality-pass notes and mandatory-fixture verification commands |
| [`phase-9c-stabilization-pass.md`](./phase-9c-stabilization-pass.md) | Operator validation pass (repo gates + manual browser checks) for the Phase 9c–9d UI work |
| [`../agent-deployment.md`](../agent-deployment.md) | Preferred long-running `signalforge-agent` deployment model and security baseline |
| [`../api-contract.md`](../api-contract.md) | Route-level operator and agent HTTP contract |

## Scope

SignalForge stays the control plane and analysis plane:

- it stores Sources and collection jobs
- it returns queued work through the agent API
- it analyzes uploaded artifacts and presents runs, compare, and findings

Collection still runs outside this repo:

- [`signalforge-agent`](https://github.com/Canepro/signalforge-agent) handles execution
- [`signalforge-collectors`](https://github.com/Canepro/signalforge-collectors) handles evidence gathering
