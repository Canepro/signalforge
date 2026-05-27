#!/usr/bin/env bash
# TEMPLATE — copy and adapt when mac:vincent-primary is enrolled; do not deploy before then.
# Source-bound automation-agent wrapper for mac:vincent-primary.
# Contract: docs/operators/selene-source-wrappers.md
#
# target_identifier : mac:vincent-primary
# artifact_family   : linux-audit-log (interim; pending mac-diagnostics family decision)
# safe_fix_policy   : none
#
# Prerequisites before using this wrapper:
#   1. mac-diagnostics artifact family decision resolved (or confirmed linux-audit-log)
#   2. Source created in SignalForge with target_identifier=mac:vincent-primary
#   3. Automation-agent token enrolled and stored at the path below
#   See: docs/operators/selene-multi-source-enrollment.md

set -euo pipefail

# ── constants ──────────────────────────────────────────────────────────────────

SOURCE_IDENTIFIER="mac:vincent-primary"
ARTIFACT_FAMILY="linux-audit-log"

# Per-source token file path (user-local; workstation convention).
# Override via SIGNALFORGE_SELENE_TOKEN_FILE for testing.
TOKEN_FILE="${SIGNALFORGE_SELENE_TOKEN_FILE:-${HOME}/.config/signalforge/selene-automation-agent-token-mac-vincent-primary}"

# SignalForge base URL. Validated after arg parsing so --help works without env.
SIGNALFORGE_BASE_URL="${SIGNALFORGE_BASE_URL:-}"

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
  cat <<EOF
Usage: $(basename "$0") [options]

Source-bound diagnostic wrapper for ${SOURCE_IDENTIFIER} (${ARTIFACT_FAMILY}).
Requests a diagnostic run through the SignalForge automation-agent API.

NOTE: This Source is planned; do not run this wrapper until the Source is enrolled.
See docs/operators/selene-multi-source-enrollment.md for enrollment prerequisites.

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

Terminal states (when --wait): submitted, failed, cancelled, expired
EOF
}

check_token_file() {
  if [[ ! -f "${TOKEN_FILE}" || ! -r "${TOKEN_FILE}" || ! -s "${TOKEN_FILE}" ]]; then
    echo "ERROR: token file not found, unreadable, or empty: ${TOKEN_FILE}" >&2
    echo "  This Source may not be enrolled yet." >&2
    echo "  See: docs/operators/selene-multi-source-enrollment.md" >&2
    exit 2
  fi
}

check_agent_script() {
  if [[ ! -f "${SIGNALFORGE_AGENT_SCRIPT}" || ! -r "${SIGNALFORGE_AGENT_SCRIPT}" ]]; then
    echo "ERROR: signalforge-automation-agent.sh not found or unreadable: ${SIGNALFORGE_AGENT_SCRIPT}" >&2
    echo "  Set SIGNALFORGE_AGENT_SCRIPT to override the path." >&2
    exit 2
  fi
}

check_base_url() {
  if [[ -z "${SIGNALFORGE_BASE_URL}" ]]; then
    echo "ERROR: SIGNALFORGE_BASE_URL must be set" >&2
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
    --reason)
      if [[ $# -lt 2 ]]; then echo "ERROR: missing value after --reason" >&2; usage >&2; exit 1; fi
      REASON="$2"; shift 2 ;;
    --wait)         WAIT_MODE=true; shift ;;
    --timeout)
      if [[ $# -lt 2 ]]; then echo "ERROR: missing value after --timeout" >&2; usage >&2; exit 1; fi
      TIMEOUT_SECONDS="$2"; shift 2 ;;
    --health-check) HEALTH_CHECK=true; shift ;;
    -h|--help)      usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

# ── main ───────────────────────────────────────────────────────────────────────

check_base_url
check_token_file

if [[ "${HEALTH_CHECK}" == "true" ]]; then
  echo "source     : ${SOURCE_IDENTIFIER}" >&2
  echo "token file : present (${TOKEN_FILE})" >&2
  check_signalforge_reachable || exit 3
  echo "health check: OK" >&2
  exit 0
fi

check_agent_script

# Load token without printing it to stdout or a shell trace.
# shellcheck disable=SC2155
SIGNALFORGE_AUTOMATION_AGENT_TOKEN="$(< "${TOKEN_FILE}")"
export SIGNALFORGE_AUTOMATION_AGENT_TOKEN

# Request diagnostic run.
REQUEST_JSON=$(
  SIGNALFORGE_BASE_URL="${SIGNALFORGE_BASE_URL}" \
  bash "${SIGNALFORGE_AGENT_SCRIPT}" request --reason "${REASON}"
)

if [[ "${WAIT_MODE}" == "true" ]]; then
  REQUEST_ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["request_id"])' <<< "${REQUEST_JSON}")
  echo "queued request_id: ${REQUEST_ID}" >&2
  SIGNALFORGE_BASE_URL="${SIGNALFORGE_BASE_URL}" \
  bash "${SIGNALFORGE_AGENT_SCRIPT}" wait "${REQUEST_ID}" --timeout "${TIMEOUT_SECONDS}"
else
  echo "${REQUEST_JSON}"
fi
