#!/usr/bin/env bash
# Submit an artifact to SignalForge and print the new run id + URL.
# Full usage: ./scripts/analyze.sh --help
# Contract: docs/external-submit.md
set -euo pipefail

BASE_URL="${SIGNALFORGE_BASE_URL:-${SIGNALFORGE_URL:-http://localhost:3000}}"
ARTIFACT_TYPE="${SIGNALFORGE_ARTIFACT_TYPE:-}"
TARGET_ID="${SIGNALFORGE_TARGET_IDENTIFIER:-}"
SOURCE_LABEL="${SIGNALFORGE_SOURCE_LABEL:-}"
COLLECTOR_TYPE="${SIGNALFORGE_COLLECTOR_TYPE:-}"
COLLECTOR_VERSION="${SIGNALFORGE_COLLECTOR_VERSION:-}"
COLLECTED_AT="${SIGNALFORGE_COLLECTED_AT:-}"

show_help() {
  cat <<'EOF'
Submit an artifact to SignalForge (multipart POST /api/runs) and print run_id, URLs, and handy read/compare commands.

Usage:
  ./scripts/analyze.sh [options] <path-to-artifact>

Options:
  --url, -u BASE          API base URL (default: SIGNALFORGE_BASE_URL or SIGNALFORGE_URL, then http://localhost:3000)
  --artifact-type VALUE   Optional explicit artifact family (linux-audit-log, container-diagnostics, kubernetes-bundle)
  --target-id VALUE       Optional stable target key (target_identifier; preferred for compare/baseline)
  --source-label VALUE    Optional human label (e.g. CI job, bastion)
  --collector-type VALUE  Optional implementation id (e.g. signalforge-collectors)
  --collector-version VALUE
  --collected-at VALUE    Optional ISO 8601 when evidence was captured on the host
  -h, --help              Show this help

Environment (optional; flags override env):
  SIGNALFORGE_BASE_URL  (preferred; for live operator/agent traffic use the ACA URL)
  SIGNALFORGE_URL       (legacy compatibility alias; avoid legacy *.vercel.app caller targets)
  SIGNALFORGE_ARTIFACT_TYPE
  SIGNALFORGE_TARGET_IDENTIFIER
  SIGNALFORGE_SOURCE_LABEL
  SIGNALFORGE_COLLECTOR_TYPE
  SIGNALFORGE_COLLECTOR_VERSION
  SIGNALFORGE_COLLECTED_AT

See docs/external-submit.md for the full external submission contract.

After success, also prints compare UI/API URLs and one-liners for signalforge-read.sh.

Read APIs (run detail, report, compare JSON): scripts/signalforge-read.sh --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "${1}" in
    --url|-u)
      BASE_URL="${2:?missing value after $1}"
      shift 2
      ;;
    --artifact-type)
      ARTIFACT_TYPE="${2:?missing value after $1}"
      shift 2
      ;;
    --target-id)
      TARGET_ID="${2:?missing value after $1}"
      shift 2
      ;;
    --source-label)
      SOURCE_LABEL="${2:?missing value after $1}"
      shift 2
      ;;
    --collector-type)
      COLLECTOR_TYPE="${2:?missing value after $1}"
      shift 2
      ;;
    --collector-version)
      COLLECTOR_VERSION="${2:?missing value after $1}"
      shift 2
      ;;
    --collected-at)
      COLLECTED_AT="${2:?missing value after $1}"
      shift 2
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
  echo "usage: $0 [--url|-u BASE_URL] [--artifact-type ...] [--target-id ...] ... <path-to-artifact-file>" >&2
  echo "Try: $0 --help" >&2
  exit 1
fi
if [[ ! -f "$FILE" ]]; then
  echo "error: not a file: $FILE" >&2
  exit 1
fi

CURL_ARGS=(-sS -X POST)
CURL_ARGS+=(-F "file=@${FILE}")
[[ -n "$ARTIFACT_TYPE" ]] && CURL_ARGS+=(-F "artifact_type=${ARTIFACT_TYPE}")
[[ -n "$TARGET_ID" ]] && CURL_ARGS+=(-F "target_identifier=${TARGET_ID}")
[[ -n "$SOURCE_LABEL" ]] && CURL_ARGS+=(-F "source_label=${SOURCE_LABEL}")
[[ -n "$COLLECTOR_TYPE" ]] && CURL_ARGS+=(-F "collector_type=${COLLECTOR_TYPE}")
[[ -n "$COLLECTOR_VERSION" ]] && CURL_ARGS+=(-F "collector_version=${COLLECTOR_VERSION}")
[[ -n "$COLLECTED_AT" ]] && CURL_ARGS+=(-F "collected_at=${COLLECTED_AT}")

RESP="$(curl "${CURL_ARGS[@]}" "${BASE_URL%/}/api/runs")"

if command -v jq >/dev/null 2>&1; then
  RUN_ID="$(echo "$RESP" | jq -r '.run_id // empty')"
  ERR="$(echo "$RESP" | jq -r '.error // empty')"
else
  # brittle fallback — prefer jq for parsing
  RUN_ID="$(printf '%s' "$RESP" | sed -n 's/.*"run_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  ERR=""
fi

if [[ -n "${ERR:-}" ]]; then
  echo "error: $ERR" >&2
  printf '%s\n' "$RESP" >&2
  exit 1
fi

if [[ -z "${RUN_ID:-}" ]]; then
  echo "error: could not parse run_id from response:" >&2
  printf '%s\n' "$RESP" >&2
  exit 1
fi

BASE_N="${BASE_URL%/}"
echo "run_id: $RUN_ID"
echo "url:    ${BASE_N}/runs/${RUN_ID}"
echo "compare_ui:  ${BASE_N}/runs/${RUN_ID}/compare"
echo "compare_api: ${BASE_N}/api/runs/${RUN_ID}/compare"
echo "read_run:    ./scripts/signalforge-read.sh --url ${BASE_N} run ${RUN_ID}"
echo "read_compare: ./scripts/signalforge-read.sh --url ${BASE_N} compare ${RUN_ID}"
