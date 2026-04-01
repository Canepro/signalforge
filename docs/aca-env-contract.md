# ACA Environment Contract

This document locks the application environment contract for the first Azure Container Apps deployment slice.

Scope:

- Azure Container Apps for the SignalForge web and API app
- Neon Postgres retained for phase 1
- no Azure database migration
- no Azure resource creation in this repo step

## Deployment shape assumptions

- one Azure Container App hosts the SignalForge Next.js web UI and API routes
- the app container image comes from the Slice 1 container build
- ACA provides the public HTTPS endpoint
- Neon remains the system of record for production data
- Vercel previews may remain in place for branch review, but not for agent upload traffic

## Required app environment

These values must be present on the ACA app before treating the deployment as valid.

| Variable | Required | Secret in ACA | Recommended value | Notes |
|---|---|---:|---|---|
| `DATABASE_DRIVER` | Yes | No | `postgres` | Lock ACA onto the durable backend |
| `DATABASE_URL` | Yes | Yes | Neon connection string | Use the Neon TLS-enabled URL as issued |

## Operator and agent-facing environment

| Variable | Required | Secret in ACA | Recommended value | Notes |
|---|---|---:|---|---|
| `SIGNALFORGE_ADMIN_TOKEN` | Yes for `/sources`, agent enrollment, and collection-job APIs | Yes | long random secret | Required for the operator flows already shipped in the app |

## Optional OpenAI direct environment

| Variable | Required when used | Secret in ACA | Recommended value | Notes |
|---|---|---:|---|---|
| `LLM_PROVIDER` | Yes | No | `openai` | Omit entirely if running deterministic-only |
| `OPENAI_API_KEY` | Yes | Yes | provider secret | App still boots without it and falls back deterministically |
| `OPENAI_MODEL` | No | No | team-selected model | Defaults remain in app code |

## Optional Azure OpenAI environment

| Variable | Required when used | Secret in ACA | Recommended value | Notes |
|---|---|---:|---|---|
| `LLM_PROVIDER` | Yes | No | `azure` | Use only when Azure OpenAI is the intended active provider |
| `AZURE_OPENAI_ENDPOINT` | Yes | No | endpoint URL | Keep the existing endpoint style rules from `README.md` |
| `AZURE_OPENAI_API_KEY` | Yes | Yes | provider secret | Store as an ACA secret |
| `AZURE_OPENAI_DEPLOYMENT` | Yes | No | deployment name | Passed as the model value on the Responses API call |
| `AZURE_OPENAI_API_VERSION` | Legacy endpoints only | No | `2025-04-01-preview` or current approved value | Omit for `/openai/v1` base URLs |

## Runtime bind behavior

The committed image already sets:

- `PORT=3000`
- `HOSTNAME=0.0.0.0`

Do not add these as ACA app secrets. Override them only if the image contract changes later.

## ACA secret classification

Store these as ACA secrets rather than plain environment values:

- `DATABASE_URL`
- `SIGNALFORGE_ADMIN_TOKEN`
- `OPENAI_API_KEY`
- `AZURE_OPENAI_API_KEY`

Keep these as plain environment values:

- `DATABASE_DRIVER`
- `LLM_PROVIDER`
- `OPENAI_MODEL`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION` when relevant

## Non-goals for Slice 2

This contract does not introduce:

- Azure Database for PostgreSQL
- Azure Key Vault wiring
- Front Door
- private ingress
- queueing, auth, or background job redesign

Those can be evaluated after the ACA app contract is stable and no longer changing under the initial hosting move.
