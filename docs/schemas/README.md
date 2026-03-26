# JSON Schemas

This folder contains lightweight Draft 2020-12 schema files for the published SignalForge API contract.

Use them for:

- agent integration
- quick validation
- documentation
- checking top-level response shapes without reading route handlers

They intentionally do **not** fully duplicate the analyzer’s full `AuditReport` or `Finding` model from `src/lib/analyzer/schema.ts`. Where those objects would be too large or too volatile, the schema documents them more loosely.

| File | Use |
|------|-----|
| `error-response.schema.json` | `{ "error": string, "code"?: string }` |
| `ingestion-metadata.schema.json` | Optional Phase 5a fields on `POST /api/runs` |
| `post-runs-response.schema.json` | Success body for `POST /api/runs` |
| `post-reanalyze-response.schema.json` | Success body for `POST /api/runs/[id]/reanalyze` |
| `get-runs-list-response.schema.json` | `GET /api/runs` |
| `run-detail-response.schema.json` | `GET /api/runs/[id]` (report summarized) |
| `compare-drift-response.schema.json` | `GET /api/runs/[id]/compare` |
| `collection-scope.schema.json` | Shared typed `collection_scope` object (`linux_host` / `container_target` / `kubernetes_scope`) |
| `source-response.schema.json` | `Source` response body used by `GET/POST/PATCH /api/sources*` |
| `collection-job-response.schema.json` | `CollectionJob` response body used by source/job routes |
| `agent-next-jobs-response.schema.json` | `GET /api/agent/jobs/next` |

Code mirrors:

- `src/types/api-contract.ts`
- `src/types/api.ts`
- `src/lib/compare/build-compare.ts`
- `src/lib/ingestion/meta.ts`

If a published route changes in a breaking way, update:

1. `docs/api-contract.md`
2. the relevant schema file in this folder
3. the matching TypeScript contract type
