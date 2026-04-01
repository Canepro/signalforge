# External Evidence Submission

Use this document when you are sending evidence into SignalForge from:

- a shell script
- a CI job
- a collector
- another service or agent

For the full HTTP surface, see [`api-contract.md`](./api-contract.md).

SignalForge **analyzes** evidence; it does **not** collect it directly.
Collectors run **outside** the app and push artifacts in over HTTP.

This document describes the current `POST /api/runs` submission contract.

**Collection jobs (Phase 6d):** agents complete a **running** job with `POST /api/collection-jobs/{id}/artifact` (`multipart/form-data`, same file + optional ingestion fields as below). Send **`instance_id`** as a form field or **`X-SignalForge-Agent-Instance-Id`** header matching the job lease. The server forces target/collector context from the bound **Source**; see [`api-contract.md`](./api-contract.md) (Phase 6d). Reference **pull-model** implementation (heartbeat, claim, collector run, upload): `signalforge-agent` (separate repo; collectors stay in **signalforge-collectors**).

## Endpoint

- **URL:** `{BASE_URL}/api/runs`
- **Method:** `POST`
- **Body:** JSON **or** `multipart/form-data`

## When To Use Which Submission Style

- use **multipart** when you already have a file on disk
- use **JSON** when another service already holds the artifact content in memory
- use the helper scripts when you want the easiest local path

## Required Payload

| Mode | Required fields |
|------|------------------|
| **JSON** | `content` (string, artifact text). Optionally `filename`, `artifact_type`, `source_type`. |
| **Multipart** | `file` (uploaded file). Optionally `artifact_type`, `source_type`. |

If `artifact_type` is omitted, the server infers a type from content.
Today, the shipped artifact families are `linux-audit-log`, `container-diagnostics`, and `kubernetes-bundle`.
If the supplied or inferred `artifact_type` is unsupported, the route returns **400** with `code: "unsupported_artifact_type"`.

For `kubernetes-bundle`, `content` should be a UTF-8 JSON manifest with `schema_version: "kubernetes-bundle.v1"` and a `documents` array of named text documents. Raw archives are not accepted in this v1 contract.

Current normalized Kubernetes document kinds include:

- service exposure
- network policies
- RBAC bindings and roles
- workload specs and workload status
- optional warning events
- optional node health summaries

## Optional Ingestion Metadata

All metadata fields are optional.
If you omit them, SignalForge behaves like a legacy upload.

| Field | Purpose |
|-------|---------|
| `target_identifier` | Stable operator- or collector-chosen id (e.g. `fleet:prod:web-01`). **Preferred** for same-target baseline selection and compare when you need stronger identity than hostname-from-log. |
| `source_label` | Human-readable origin (e.g. `github-actions`, `laptop`, `bastion`). |
| `collector_type` | Implementation id (e.g. `signalforge-collectors`). |
| `collector_version` | Version string of the collector. |
| `collected_at` | ISO 8601 timestamp of when evidence was **captured on the host** (parsed and normalized server-side). |

**JSON:** same keys as top-level properties next to `content` and `filename`.

**Multipart:** same names as additional form fields alongside `file`.

Length limits and validation follow `src/lib/ingestion/meta.ts` (e.g. `collected_at` must parse as a valid date-time).

## Target Identity vs Hostname

- **Hostname** is still derived from the artifact by the adapter (`linux-audit-log`) when present.
- **`target_identifier`** is **submission metadata**: use it when you have a fleet id, enrollment id, or stable label that should tie runs together even if hostnames differ or logs are ambiguous.
- Compare and baseline selection use **`target_identifier` first**, then normalized hostname, then same-artifact history when identity is missing (see `findPreviousRunForSameTarget`).

### Recommended `target_identifier` shapes by artifact family

- **`linux-audit-log`**: use a stable machine or fleet id such as `fleet:prod:web-01` when hostname alone is not trustworthy enough.
- **`container-diagnostics`**: choose the compare scope deliberately.
  - workload-stable compare: `container-workload:<host>:<runtime>:<service>`
  - instance-level compare: `container-instance:<host>:<runtime>:<container-id>`
- **`kubernetes-bundle`**: make cluster and scope explicit.
  - cluster-scoped bundle: `cluster:<cluster-name>`
  - namespace-scoped bundle: `cluster:<cluster-name>:namespace:<namespace>`

For container and Kubernetes evidence, prefer workload- or scope-stable identifiers over volatile runtime object names when the operator wants meaningful compare history across redeploys.

## Quick Examples

Multipart with curl:

```bash
curl -X POST \
  -F "file=@./server_audit.log" \
  -F "target_identifier=fleet:prod:web-01" \
  -F "collector_type=signalforge-collectors" \
  -F "collector_version=1.0.0" \
  -F "collected_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  http://localhost:3000/api/runs
```

JSON:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"content":"...raw artifact text...","filename":"server_audit.log"}' \
  http://localhost:3000/api/runs
```

## Easiest Local Paths

Submit a local file with the built-in helper:

```bash
./scripts/analyze.sh ./audit.log
```

For non-Linux artifacts, prefer an explicit type:

```bash
./scripts/analyze.sh --artifact-type container-diagnostics ./payments-container.txt
./scripts/analyze.sh --artifact-type kubernetes-bundle ./payments-bundle.json
```

On success it prints `run_id`, the run URL, **compare** UI/API URLs, and ready-to-run `signalforge-read.sh` lines (use `--url` if SignalForge is not on port 3000).

Read the created run back:

```bash
./scripts/signalforge-read.sh run <run-id>
```

Use the external reference collector from the companion repo [signalforge-collectors](https://github.com/Canepro/signalforge-collectors):

```bash
git clone https://github.com/Canepro/signalforge-collectors.git
cd signalforge-collectors
./submit-to-signalforge.sh --file examples/sample_audit.log --url http://localhost:3000
```

## Reference Collector (outside SignalForge)

The **`signalforge-collectors`** repository includes a narrow **reference push path**: `submit-to-signalforge.sh` runs `first-audit.sh` (or accepts `--file` for an existing log) and POSTs to this contract with `collector_type=signalforge-collectors` and related metadata.

That same pattern can later be reused for:

- container diagnostics
- Windows evidence packs
- macOS evidence packs
- other externally collected artifacts

## Read Back Run / Compare Data

`GET /api/runs/{id}/compare` returns deterministic compare data for programmatic use using the same logic as `/runs/{id}/compare`. Optional query: `?against=<otherRunId>` pins the baseline. Response includes `current`, `baseline`, `baseline_missing`, `target_mismatch`, `baseline_selection`, `drift` (`summary` + `rows`), and `evidence_delta` for stable metadata and aggregate evidence changes. Each run snapshot includes `id` and `run_id` (same UUID) for consistency with POST responses. No LLM.

From the shell, `scripts/signalforge-read.sh compare <run-id>` prints the same JSON, with optional `--against <id>`. `signalforge-read.sh run` and `report` call `GET /api/runs/{id}` and `GET /api/runs/{id}/report` respectively. These are the read-side complements to `scripts/analyze.sh`.

## CLI Helpers

`scripts/analyze.sh` wraps multipart upload and accepts optional flags or `SIGNALFORGE_*` env vars for the same fields. Examples:

```bash
./scripts/analyze.sh ./audit.log
./scripts/analyze.sh --artifact-type container-diagnostics ./payments-container.txt
./scripts/analyze.sh --target-id 'fleet:prod:web-01' --collector-type signalforge-collectors ./audit.log
SIGNALFORGE_ARTIFACT_TYPE=kubernetes-bundle ./scripts/analyze.sh ./payments-bundle.json
SIGNALFORGE_BASE_URL=https://example.com SIGNALFORGE_COLLECTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" ./scripts/analyze.sh ./audit.log
```

## What SignalForge Does Not Do

- No in-product **collection** (no SSH, no remote execution, no scheduler in this contract).
- No **auth** on this route in the current product (secure your deployment and network as needed).
- **Source registration** exists via `/sources` (Phase 6c) for operator-managed targets and collection jobs. The `POST /api/runs` path described here remains available for direct submissions without source context.

For product boundary and future collector direction, see [`../plans/phase-5-collector-architecture.md`](../plans/phase-5-collector-architecture.md).
