#!/usr/bin/env bash
# Public template. Copy to a private operations repo and set the constants below.
# Do not commit real source names, token paths, kubeconfig paths, or tokens here.

set -euo pipefail

SOURCE_IDENTIFIER="${SIGNALFORGE_SOURCE_IDENTIFIER:-kubernetes:<cluster-name>}"
ARTIFACT_FAMILY="kubernetes-bundle"
TOKEN_FILE="${SIGNALFORGE_TOKEN_FILE:-/var/lib/signalforge/automation-agent-token-kubernetes-cluster}"
SIGNALFORGE_BASE_URL="${SIGNALFORGE_BASE_URL:-}"

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIGNALFORGE_AGENT_SCRIPT="${SIGNALFORGE_AGENT_SCRIPT:-"${_SCRIPT_DIR}/../../scripts/signalforge-automation-agent.sh"}"

REASON="automation-agent-wrapper: ${SOURCE_IDENTIFIER}"
WAIT_MODE=false
TIMEOUT_SECONDS=300
HEALTH_CHECK=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Source-bound diagnostic wrapper template for ${SOURCE_IDENTIFIER}
(${ARTIFACT_FAMILY}). Set SIGNALFORGE_SOURCE_IDENTIFIER and
SIGNALFORGE_TOKEN_FILE in the private deployment.

Options:
  --reason TEXT       Diagnostic request reason (default: "${REASON}")
  --wait              Poll until request reaches a terminal state
  --timeout SECONDS   Wait timeout in seconds (default: ${TIMEOUT_SECONDS})
  --health-check      Validate token file and SignalForge reachability; no request
  -h, --help          Show this help

Required environment:
  SIGNALFORGE_BASE_URL

Optional environment:
  SIGNALFORGE_SOURCE_IDENTIFIER
  SIGNALFORGE_TOKEN_FILE
  SIGNALFORGE_AGENT_SCRIPT
EOF
}

check_base_url() {
  if [[ -z "${SIGNALFORGE_BASE_URL}" ]]; then
    echo "ERROR: SIGNALFORGE_BASE_URL must be set" >&2
    exit 2
  fi
}

check_token_file() {
  if [[ ! -f "${TOKEN_FILE}" || ! -r "${TOKEN_FILE}" || ! -s "${TOKEN_FILE}" ]]; then
    echo "ERROR: token file not found, unreadable, or empty: ${TOKEN_FILE}" >&2
    echo "  See: docs/operators/automation-agent-multi-source-enrollment.md" >&2
    exit 2
  fi
}

check_agent_script() {
  if [[ ! -f "${SIGNALFORGE_AGENT_SCRIPT}" || ! -r "${SIGNALFORGE_AGENT_SCRIPT}" ]]; then
    echo "ERROR: signalforge-automation-agent.sh not found or unreadable: ${SIGNALFORGE_AGENT_SCRIPT}" >&2
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason)
      if [[ $# -lt 2 ]]; then echo "ERROR: missing value after --reason" >&2; usage >&2; exit 1; fi
      REASON="$2"; shift 2 ;;
    --wait) WAIT_MODE=true; shift ;;
    --timeout)
      if [[ $# -lt 2 ]]; then echo "ERROR: missing value after --timeout" >&2; usage >&2; exit 1; fi
      TIMEOUT_SECONDS="$2"; shift 2 ;;
    --health-check) HEALTH_CHECK=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

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
SIGNALFORGE_AUTOMATION_AGENT_TOKEN="$(< "${TOKEN_FILE}")"
export SIGNALFORGE_AUTOMATION_AGENT_TOKEN

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
