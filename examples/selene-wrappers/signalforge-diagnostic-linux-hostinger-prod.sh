#!/usr/bin/env bash
# TEMPLATE — copy to velora-infra and adapt; do not deploy from examples/ directly.
# Source-bound automation-agent wrapper for linux:hostinger-prod.
# Contract: docs/operators/selene-source-wrappers.md
#
# target_identifier : linux:hostinger-prod
# artifact_family   : linux-audit-log
# safe_fix_policy   : none

set -euo pipefail

# ── constants ──────────────────────────────────────────────────────────────────

SOURCE_IDENTIFIER="linux:hostinger-prod"
ARTIFACT_FAMILY="linux-audit-log"

# Per-source token file path (slice 3 convention).
# Override via SIGNALFORGE_SELENE_TOKEN_FILE for testing.
TOKEN_FILE="${SIGNALFORGE_SELENE_TOKEN_FILE:-/etc/velora-infra/selene/secrets/signalforge-automation-agent-token-linux-hostinger-prod}"

# SignalForge base URL — must be set in the deployment environment.
: "${SIGNALFORGE_BASE_URL:?SIGNALFORGE_BASE_URL must be set}"

# Path to signalforge-automation-agent.sh.
# Override SIGNALFORGE_AGENT_SCRIPT when deployed outside the repo.
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIGNALFORGE_AGENT_SCRIPT="${SIGNALFORGE_AGENT_SCRIPT:-"${_SCRIPT_DIR}/../../scripts/signalforge-automation-agent.sh"}"

# ── defaults ───────────────────────────────────────────────────────────────────

REASON="selene-wrapper: ${SOURCE_IDENTIFIER}"
WAIT_MODE=false
TIMEOUT_SECONDS=300
HEALTH_CHECK=false

# ── helpers ────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") [options]

Source-bound diagnostic wrapper for ${SOURCE_IDENTIFIER} (${ARTIFACT_FAMILY}).
Requests a diagnostic run through the SignalForge automation-agent API.

Options:
  --reason TEXT       Diagnostic request reason (default: "${REASON}")
  --wait              Poll until request reaches a terminal state
  --timeout SECONDS   Wait timeout in seconds (default: ${TIMEOUT_SECONDS})
  --health-check      Validate token file and SignalForge reachability; no request
  -h, --help          Show this help

Required environment:
  SIGNALFORGE_BASE_URL            SignalForge base URL

Optional environment:
  SIGNALFORGE_SELENE_TOKEN_FILE   Override token file path
  SIGNALFORGE_AGENT_SCRIPT        Override path to signalforge-automation-agent.sh

Preflight: confirm signalforge-agent is running and heartbeating for this Source
before requesting collection. A request with no available execution agent will
reach 'failed' or remain pending until the job expires.

Terminal states (when --wait): submitted, failed, cancelled, expired
EOF
  exit 1
}

check_token_file() {
  if [[ ! -f "${TOKEN_FILE}" ]]; then
    echo "ERROR: token file not found: ${TOKEN_FILE}" >&2
    echo "  See: docs/operators/selene-multi-source-enrollment.md" >&2
    exit 2
  fi
}

check_agent_script() {
  if [[ ! -x "${SIGNALFORGE_AGENT_SCRIPT}" ]]; then
    echo "ERROR: signalforge-automation-agent.sh not found or not executable: ${SIGNALFORGE_AGENT_SCRIPT}" >&2
    echo "  Set SIGNALFORGE_AGENT_SCRIPT to override the path." >&2
    exit 2
  fi
}

check_signalforge_reachable() {
  if curl -fsS --max-time 5 "${SIGNALFORGE_BASE_URL%/}/api/health" >/dev/null 2>&1; then
    echo "SignalForge reachable: ${SIGNALFORGE_BASE_URL}" >&2
    return 0
  fi
  echo "WARNING: SignalForge health check failed: ${SIGNALFORGE_BASE_URL%/}/api/health" >&2
  return 1
}

# ── arg parse ──────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason)       REASON="$2"; shift 2 ;;
    --wait)         WAIT_MODE=true; shift ;;
    --timeout)      TIMEOUT_SECONDS="$2"; shift 2 ;;
    --health-check) HEALTH_CHECK=true; shift ;;
    -h|--help)      usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

# ── main ───────────────────────────────────────────────────────────────────────

check_token_file
check_agent_script

if [[ "${HEALTH_CHECK}" == "true" ]]; then
  echo "source     : ${SOURCE_IDENTIFIER}" >&2
  echo "token file : present (${TOKEN_FILE})" >&2
  check_signalforge_reachable || exit 3
  echo "health check: OK" >&2
  exit 0
fi

# Load token without printing it to stdout or a shell trace.
# shellcheck disable=SC2155
SIGNALFORGE_AUTOMATION_AGENT_TOKEN="$(< "${TOKEN_FILE}")"
export SIGNALFORGE_AUTOMATION_AGENT_TOKEN

# Request diagnostic run.
REQUEST_JSON=$(
  SIGNALFORGE_BASE_URL="${SIGNALFORGE_BASE_URL}" \
  "${SIGNALFORGE_AGENT_SCRIPT}" request --reason "${REASON}"
)
echo "${REQUEST_JSON}"

if [[ "${WAIT_MODE}" == "true" ]]; then
  REQUEST_ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<< "${REQUEST_JSON}")
  SIGNALFORGE_BASE_URL="${SIGNALFORGE_BASE_URL}" \
  "${SIGNALFORGE_AGENT_SCRIPT}" wait "${REQUEST_ID}" --timeout "${TIMEOUT_SECONDS}"
fi
