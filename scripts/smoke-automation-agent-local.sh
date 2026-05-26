#!/usr/bin/env bash
# End-to-end local smoke for automation-agent -> collection-job -> execution-agent -> findings.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

BASE_URL="${SIGNALFORGE_BASE_URL:-}"
HOST="${SIGNALFORGE_SMOKE_HOST:-127.0.0.1}"
PORT="${SIGNALFORGE_SMOKE_PORT:-3210}"
ARTIFACT_PATH="${SIGNALFORGE_SMOKE_ARTIFACT_PATH:-${REPO_ROOT}/tests/fixtures/sample-prod-server.log}"
ADMIN_TOKEN="${SIGNALFORGE_ADMIN_TOKEN:-}"
KEEP_SERVER="false"
REUSE_SERVER="false"
SERVER_PID=""
SERVER_LOG=""
DB_PATH=""

show_help() {
  cat <<'EOF'
Run a local end-to-end smoke for the automation-agent diagnostics flow.

This proves the full path:
  automation agent request
  -> queued collection job
  -> execution-agent heartbeat / claim / start / artifact upload
  -> automation-agent findings poll

Usage:
  ./scripts/smoke-automation-agent-local.sh [options]

Options:
  --url, -u BASE       Reuse an existing SignalForge base URL instead of starting a local dev server
  --host VALUE         Host for a temporary local dev server (default: 127.0.0.1)
  --port VALUE         Port for a temporary local dev server (default: 3210)
  --artifact PATH      Artifact fixture to upload (default: tests/fixtures/sample-prod-server.log)
  --keep-server        Leave the temporary dev server running after the smoke completes
  -h, --help           Show this help

Environment:
  SIGNALFORGE_BASE_URL             Reuse an existing app instead of booting a temp server
  SIGNALFORGE_ADMIN_TOKEN          Required only when reusing an existing app
  SIGNALFORGE_SMOKE_HOST           Override temporary server host
  SIGNALFORGE_SMOKE_PORT           Override temporary server port
  SIGNALFORGE_SMOKE_ARTIFACT_PATH  Override uploaded artifact path

Examples:
  bash ./scripts/smoke-automation-agent-local.sh
  bash ./scripts/smoke-automation-agent-local.sh --url http://127.0.0.1:3000

Success output includes:
  source_id
  request_id
  run_id
  request_status
  final top action
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

cleanup() {
  local exit_code=$?
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    if [[ "$KEEP_SERVER" == "true" && $exit_code -eq 0 ]]; then
      echo "info: leaving local dev server running on ${BASE_URL} (pid ${SERVER_PID})" >&2
      echo "info: server log: ${SERVER_LOG}" >&2
    else
      kill "$SERVER_PID" >/dev/null 2>&1 || true
      wait "$SERVER_PID" >/dev/null 2>&1 || true
    fi
  fi

  if [[ -n "$DB_PATH" && "$KEEP_SERVER" != "true" ]]; then
    rm -f "$DB_PATH"
  fi
  if [[ -n "$SERVER_LOG" && "$KEEP_SERVER" != "true" ]]; then
    rm -f "$SERVER_LOG"
  fi

  exit "$exit_code"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url|-u)
      BASE_URL="${2:?missing value after $1}"
      REUSE_SERVER="true"
      shift 2
      ;;
    --host)
      HOST="${2:?missing value after $1}"
      shift 2
      ;;
    --port)
      PORT="${2:?missing value after $1}"
      shift 2
      ;;
    --artifact)
      ARTIFACT_PATH="${2:?missing value after $1}"
      shift 2
      ;;
    --keep-server)
      KEEP_SERVER="true"
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      echo "Try: $0 --help" >&2
      exit 1
      ;;
  esac
done

require_cmd bun
require_cmd curl
require_cmd python3

if [[ ! -f "$ARTIFACT_PATH" ]]; then
  echo "error: artifact path does not exist: $ARTIFACT_PATH" >&2
  exit 1
fi

if [[ "$REUSE_SERVER" == "true" ]]; then
  if [[ -z "$BASE_URL" ]]; then
    echo "error: --url requires a base URL value" >&2
    exit 1
  fi
  if [[ -z "$ADMIN_TOKEN" ]]; then
    echo "error: SIGNALFORGE_ADMIN_TOKEN is required when reusing an existing app" >&2
    exit 1
  fi
else
  BASE_URL="http://${HOST}:${PORT}"
  ADMIN_TOKEN="local-admin-token-smoke"
  DB_PATH="/tmp/signalforge-automation-smoke-${PORT}.db"
  SERVER_LOG="$(mktemp "/tmp/signalforge-automation-smoke-${PORT}.XXXX.log")"
  rm -f "$DB_PATH"

  (
    cd "$REPO_ROOT"
    PORT="$PORT" \
    HOSTNAME="$HOST" \
    DATABASE_DRIVER=sqlite \
    DATABASE_PATH="$DB_PATH" \
    SIGNALFORGE_ADMIN_TOKEN="$ADMIN_TOKEN" \
    bun run dev -- --hostname "$HOST" --port "$PORT"
  ) >"$SERVER_LOG" 2>&1 &
  SERVER_PID="$!"

  echo "info: starting temporary local SignalForge on ${BASE_URL}" >&2
  ready="false"
  for _ in $(seq 1 60); do
    if curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; then
      ready="true"
      break
    fi
    if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
      echo "error: local dev server exited before becoming ready" >&2
      cat "$SERVER_LOG" >&2
      exit 1
    fi
    sleep 1
  done
  if [[ "$ready" != "true" ]]; then
    echo "error: timed out waiting for ${BASE_URL}/api/health" >&2
    cat "$SERVER_LOG" >&2
    exit 1
  fi
fi

BASE="${BASE_URL%/}"
INSTANCE_ID="codex-smoke-$(date +%s)"

source_resp="$(curl -fsS -X POST "${BASE}/api/sources" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data '{
    "display_name":"Codex Local Smoke Source",
    "target_identifier":"codex-local-smoke-source",
    "source_type":"linux_host",
    "expected_artifact_type":"linux-audit-log",
    "default_collector_type":"first-audit",
    "enabled":true
  }')"
SOURCE_ID="$(printf '%s' "$source_resp" | json_get 'id')"

agent_resp="$(curl -fsS -X POST "${BASE}/api/agent/registrations" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data "{\"source_id\":\"${SOURCE_ID}\",\"display_name\":\"codex-local-exec\"}")"
AGENT_TOKEN="$(printf '%s' "$agent_resp" | json_get 'token')"

automation_resp="$(curl -fsS -X POST "${BASE}/api/automation-agent/registrations" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data "{\"source_id\":\"${SOURCE_ID}\",\"display_name\":\"codex-local-automation\"}")"
AUTOMATION_TOKEN="$(printf '%s' "$automation_resp" | json_get 'token')"

request_resp="$(
  SIGNALFORGE_BASE_URL="$BASE" \
  SIGNALFORGE_AUTOMATION_AGENT_TOKEN="$AUTOMATION_TOKEN" \
  bash "${REPO_ROOT}/scripts/signalforge-automation-agent.sh" request \
    --reason "codex local automation-agent smoke"
)"
REQUEST_ID="$(printf '%s' "$request_resp" | json_get 'request_id')"

heartbeat_resp="$(curl -fsS -X POST "${BASE}/api/agent/heartbeat" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -H "content-type: application/json" \
  --data '{"agent_version":"codex-local-smoke","capabilities":["collect:linux-audit-log"],"attributes":{"mode":"local-smoke"}}')"

next_resp="$(curl -fsS "${BASE}/api/agent/jobs/next?limit=1" \
  -H "authorization: Bearer ${AGENT_TOKEN}")"
JOB_ID="$(printf '%s' "$next_resp" | json_get 'jobs' | python3 -c 'import json,sys; jobs=json.load(sys.stdin); print(jobs[0]["id"] if jobs else "")')"

if [[ "$JOB_ID" != "$REQUEST_ID" ]]; then
  echo "error: queued job does not match automation-agent request id" >&2
  echo "request_id=${REQUEST_ID}" >&2
  echo "job_id=${JOB_ID}" >&2
  exit 1
fi

claim_resp="$(curl -fsS -X POST "${BASE}/api/collection-jobs/${JOB_ID}/claim" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -H "content-type: application/json" \
  --data "{\"instance_id\":\"${INSTANCE_ID}\",\"lease_ttl_seconds\":300}")"

start_resp="$(curl -fsS -X POST "${BASE}/api/collection-jobs/${JOB_ID}/start" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -H "content-type: application/json" \
  --data "{\"instance_id\":\"${INSTANCE_ID}\"}")"

artifact_resp="$(curl -fsS -X POST "${BASE}/api/collection-jobs/${JOB_ID}/artifact" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -F "instance_id=${INSTANCE_ID}" \
  -F 'artifact_type=linux-audit-log' \
  -F "file=@${ARTIFACT_PATH}")"

final_resp="$(
  SIGNALFORGE_BASE_URL="$BASE" \
  SIGNALFORGE_AUTOMATION_AGENT_TOKEN="$AUTOMATION_TOKEN" \
  bash "${REPO_ROOT}/scripts/signalforge-automation-agent.sh" wait \
    "$REQUEST_ID" \
    --interval 1 \
    --timeout 30
)"

REQUEST_STATUS="$(printf '%s' "$final_resp" | json_get 'request.status')"
RUN_ID="$(printf '%s' "$final_resp" | json_get 'result.run_id')"
TOP_ACTION="$(
  printf '%s' "$final_resp" | json_get 'result.top_actions_now' | \
    python3 -c 'import json,sys; data=json.load(sys.stdin); print(data[0] if data else "")'
)"

if [[ "$REQUEST_STATUS" != "submitted" ]]; then
  echo "error: smoke completed with unexpected request status: ${REQUEST_STATUS}" >&2
  printf '%s\n' "$final_resp" >&2
  exit 1
fi

if [[ -z "$RUN_ID" ]]; then
  echo "error: smoke completed without a result.run_id" >&2
  printf '%s\n' "$final_resp" >&2
  exit 1
fi

printf 'base_url=%s\n' "$BASE"
printf 'source_id=%s\n' "$SOURCE_ID"
printf 'request_id=%s\n' "$REQUEST_ID"
printf 'job_id=%s\n' "$JOB_ID"
printf 'run_id=%s\n' "$RUN_ID"
printf 'request_status=%s\n' "$REQUEST_STATUS"
printf 'heartbeat_ok=%s\n' "$(printf '%s' "$heartbeat_resp" | json_get 'ok')"
printf 'claim_status=%s\n' "$(printf '%s' "$claim_resp" | json_get 'status')"
printf 'start_status=%s\n' "$(printf '%s' "$start_resp" | json_get 'status')"
printf 'artifact_run_status=%s\n' "$(printf '%s' "$artifact_resp" | json_get 'run_status')"
printf 'top_action=%s\n' "$TOP_ACTION"
