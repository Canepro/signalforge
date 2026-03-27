# Operator Docs

Use this section when you are running SignalForge as an operator rather than just trying a first local upload.

This is where Sources, collection jobs, agent enrollment, environment-specific collection guidance, and the typed `collection_scope` model now live.

## Recommended Reading Path

1. [`sources-and-agents.md`](./sources-and-agents.md)
2. [`collection-paths.md`](./collection-paths.md)
3. [`job-scoped-collection.md`](./job-scoped-collection.md)
4. [`../agent-deployment.md`](../agent-deployment.md)

## Documents

| Document | Use it for |
|---|---|
| [`sources-and-agents.md`](./sources-and-agents.md) | Sources UI, agent enrollment, collection-job lifecycle, and the control-plane / execution-plane split |
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
