#!/usr/bin/env bash
# Register and drive automation-agent diagnostics against SignalForge over HTTP.
# Contract: docs/api-contract.md and docs/operators/automation-agent-integration.md
set -euo pipefail

BASE_URL="${SIGNALFORGE_BASE_URL:-${SIGNALFORGE_URL:-http://localhost:3000}}"
ADMIN_TOKEN="${SIGNALFORGE_ADMIN_TOKEN:-}"
AUTOMATION_TOKEN="${SIGNALFORGE_AUTOMATION_AGENT_TOKEN:-}"
DEFAULT_INTERVAL_SECONDS="${SIGNALFORGE_AUTOMATION_POLL_INTERVAL_SECONDS:-2}"
DEFAULT_TIMEOUT_SECONDS="${SIGNALFORGE_AUTOMATION_WAIT_TIMEOUT_SECONDS:-300}"

show_help() {
  cat <<'EOF'
Register and use a SignalForge automation-agent integration over HTTP.

Usage:
  ./scripts/signalforge-automation-agent.sh [--url|-u BASE] <command> [args]

Commands:
  register <source-id> [--display-name NAME] [--print-exports]
      POST /api/automation-agent/registrations using the admin token.
      Prints response JSON to stdout. With --print-exports, prints ready-to-export
      env lines to stderr for shell bootstrap without breaking JSON stdout.

  request [--reason TEXT] [--idempotency-key KEY]
      POST /api/automation-agent/diagnostic-requests using the automation-agent token.
      Prints the accepted response JSON.

  poll <request-id>
      GET /api/automation-agent/diagnostic-requests/[id] and print JSON.

  wait <request-id> [--interval SECONDS] [--timeout SECONDS]
      Poll until the request reaches a terminal state, then print the final JSON.
      Terminal states: submitted, failed, cancelled, expired.

Options:
  --url, -u BASE    API base URL (default: SIGNALFORGE_BASE_URL or SIGNALFORGE_URL, then http://localhost:3000)
  -h, --help        Show this help

Environment:
  SIGNALFORGE_BASE_URL                 Preferred API base URL
  SIGNALFORGE_URL                      Legacy compatibility alias
  SIGNALFORGE_ADMIN_TOKEN              Required for register
  SIGNALFORGE_AUTOMATION_AGENT_TOKEN   Required for request, poll, wait
  SIGNALFORGE_AUTOMATION_POLL_INTERVAL_SECONDS
  SIGNALFORGE_AUTOMATION_WAIT_TIMEOUT_SECONDS

Examples:
  ./scripts/signalforge-automation-agent.sh --url http://localhost:3000 register <source-id> --display-name operator-agent --print-exports
  ./scripts/signalforge-automation-agent.sh request --reason "investigate target drift"
  ./scripts/signalforge-automation-agent.sh poll <request-id>
  ./scripts/signalforge-automation-agent.sh wait <request-id> --timeout 600

Connection model:
  The external automation agent connects to SignalForge over HTTP.
  It is not a plugin loaded into the app process and it does not reuse the execution-agent token.
  SignalForge remains the control plane and analysis plane; the external automation agent is a separate API consumer.

See:
  docs/api-contract.md
  docs/operators/automation-agent-integration.md
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

json_get() {
  local expr="$1"
  python3 -c '
import json
import sys

expr = sys.argv[1]
data = json.load(sys.stdin)

value = data
for part in expr.split("."):
    if isinstance(value, dict):
        value = value.get(part)
    else:
        value = None
        break

if value is None:
    print("")
elif isinstance(value, bool):
    print("true" if value else "false")
elif isinstance(value, (dict, list)):
    print(json.dumps(value))
else:
    print(value)
' "$expr"
}

curl_json() {
  local method="$1"
  local url="$2"
  local auth_header="$3"
  local body="${4:-}"
  local tmp
  tmp="$(mktemp)"

  local http_code
  if [[ -n "$body" ]]; then
    http_code="$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" \
      -H "$auth_header" \
      -H "content-type: application/json" \
      --data "$body" \
      "$url")" || {
        echo "error: request failed (${url})" >&2
        exit 1
      }
  else
    http_code="$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" \
      -H "$auth_header" \
      "$url")" || {
        echo "error: request failed (${url})" >&2
        exit 1
      }
  fi

  cat "$tmp"
  if [[ "$http_code" != "200" && "$http_code" != "201" ]]; then
    echo >&2
    echo "signalforge-automation-agent: HTTP ${http_code} — ${url}" >&2
    rm -f "$tmp"
    exit 1
  fi
  rm -f "$tmp"
}

while [[ $# -gt 0 ]]; do
  case "${1}" in
    --url|-u)
      BASE_URL="${2:?missing value after $1}"
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

CMD="${1:-}"
shift || true

case "$CMD" in
  register|request|poll|wait) ;;
  "")
    echo "usage: $0 [--url|-u BASE] <register|request|poll|wait> ..." >&2
    echo "Try: $0 --help" >&2
    exit 1
    ;;
  *)
    echo "error: unknown command: ${CMD}" >&2
    echo "Try: $0 --help" >&2
    exit 1
    ;;
esac

require_cmd curl
require_cmd python3

BASE="${BASE_URL%/}"

case "$CMD" in
  register)
    SOURCE_ID="${1:-}"
    if [[ -z "$SOURCE_ID" ]]; then
      echo "usage: $0 [--url|-u BASE] register <source-id> [--display-name NAME] [--print-exports]" >&2
      exit 1
    fi
    shift || true

    DISPLAY_NAME=""
    PRINT_EXPORTS="false"
    while [[ $# -gt 0 ]]; do
      case "${1}" in
        --display-name)
          DISPLAY_NAME="${2:?missing value after $1}"
          shift 2
          ;;
        --print-exports)
          PRINT_EXPORTS="true"
          shift
          ;;
        *)
          echo "error: unexpected argument: $1" >&2
          exit 1
          ;;
      esac
    done

    if [[ -z "$ADMIN_TOKEN" ]]; then
      echo "error: SIGNALFORGE_ADMIN_TOKEN is required for register" >&2
      exit 1
    fi

    body="$(python3 - "$SOURCE_ID" "$DISPLAY_NAME" <<'PY'
import json
import sys
payload = {"source_id": sys.argv[1]}
if sys.argv[2]:
    payload["display_name"] = sys.argv[2]
print(json.dumps(payload))
PY
)"
    resp="$(curl_json "POST" "${BASE}/api/automation-agent/registrations" "authorization: Bearer ${ADMIN_TOKEN}" "$body")"
    printf '%s\n' "$resp"
    token="$(printf '%s' "$resp" | json_get 'token')"
    if [[ "$PRINT_EXPORTS" == "true" && -n "$token" ]]; then
      echo "export SIGNALFORGE_BASE_URL=${BASE}" >&2
      echo "export SIGNALFORGE_AUTOMATION_AGENT_TOKEN=${token}" >&2
    fi
    ;;

  request)
    REASON=""
    IDEMPOTENCY_KEY=""
    while [[ $# -gt 0 ]]; do
      case "${1}" in
        --reason)
          REASON="${2:?missing value after $1}"
          shift 2
          ;;
        --idempotency-key)
          IDEMPOTENCY_KEY="${2:?missing value after $1}"
          shift 2
          ;;
        *)
          echo "error: unexpected argument: $1" >&2
          exit 1
          ;;
      esac
    done

    if [[ -z "$AUTOMATION_TOKEN" ]]; then
      echo "error: SIGNALFORGE_AUTOMATION_AGENT_TOKEN is required for request" >&2
      exit 1
    fi

    body="$(python3 - "$REASON" "$IDEMPOTENCY_KEY" <<'PY'
import json
import sys
payload = {}
if sys.argv[1]:
    payload["request_reason"] = sys.argv[1]
if sys.argv[2]:
    payload["idempotency_key"] = sys.argv[2]
print(json.dumps(payload))
PY
)"
    curl_json "POST" "${BASE}/api/automation-agent/diagnostic-requests" "authorization: Bearer ${AUTOMATION_TOKEN}" "$body"
    ;;

  poll)
    REQUEST_ID="${1:-}"
    if [[ -z "$REQUEST_ID" ]]; then
      echo "usage: $0 [--url|-u BASE] poll <request-id>" >&2
      exit 1
    fi
    if [[ -z "$AUTOMATION_TOKEN" ]]; then
      echo "error: SIGNALFORGE_AUTOMATION_AGENT_TOKEN is required for poll" >&2
      exit 1
    fi
    curl_json "GET" "${BASE}/api/automation-agent/diagnostic-requests/${REQUEST_ID}" "authorization: Bearer ${AUTOMATION_TOKEN}"
    ;;

  wait)
    REQUEST_ID="${1:-}"
    if [[ -z "$REQUEST_ID" ]]; then
      echo "usage: $0 [--url|-u BASE] wait <request-id> [--interval SECONDS] [--timeout SECONDS]" >&2
      exit 1
    fi
    shift || true
    INTERVAL_SECONDS="$DEFAULT_INTERVAL_SECONDS"
    TIMEOUT_SECONDS="$DEFAULT_TIMEOUT_SECONDS"

    while [[ $# -gt 0 ]]; do
      case "${1}" in
        --interval)
          INTERVAL_SECONDS="${2:?missing value after $1}"
          shift 2
          ;;
        --timeout)
          TIMEOUT_SECONDS="${2:?missing value after $1}"
          shift 2
          ;;
        *)
          echo "error: unexpected argument: $1" >&2
          exit 1
          ;;
      esac
    done

    if [[ -z "$AUTOMATION_TOKEN" ]]; then
      echo "error: SIGNALFORGE_AUTOMATION_AGENT_TOKEN is required for wait" >&2
      exit 1
    fi

    deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
    while true; do
      resp="$(curl_json "GET" "${BASE}/api/automation-agent/diagnostic-requests/${REQUEST_ID}" "authorization: Bearer ${AUTOMATION_TOKEN}")"
      status="$(printf '%s' "$resp" | json_get 'request.status')"
      case "$status" in
        submitted|failed|cancelled|expired)
          printf '%s\n' "$resp"
          exit 0
          ;;
      esac

      if (( $(date +%s) >= deadline )); then
        echo "error: timed out waiting for diagnostic request ${REQUEST_ID}" >&2
        printf '%s\n' "$resp"
        exit 1
      fi
      sleep "$INTERVAL_SECONDS"
    done
    ;;
esac
