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

## Documents

| Document | Use it for |
|---|---|
| [`sources-and-agents.md`](./sources-and-agents.md) | Sources UI, agent enrollment, collection-job lifecycle, and the control-plane / execution-plane split |
| [`automation-agent-integration.md`](./automation-agent-integration.md) | How external AI agents connect over HTTP, bootstrap source-bound tokens, and request diagnostics safely |
| [`autonomous-kubernetes-actions.md`](./autonomous-kubernetes-actions.md) | Opt-in Kubernetes automation signals, safe-fix policies, dry-run/apply evidence, and post-fix verification |
| [`collection-paths.md`](./collection-paths.md) | Honest push-first vs job-driven guidance by environment |
| [`job-scoped-collection.md`](./job-scoped-collection.md) | Typed collection-scope defaults and overrides, what SignalForge stores today, and what still depends on sibling repos |
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
