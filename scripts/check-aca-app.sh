#!/usr/bin/env bash
# Smoke-check a SignalForge ACA app endpoint.
set -euo pipefail

BASE_URL=""
TIMEOUT_SECONDS="${ACA_CHECK_TIMEOUT_SECONDS:-20}"
ADMIN_TOKEN="${SIGNALFORGE_ADMIN_TOKEN:-}"

show_help() {
  cat <<'EOF'
Smoke-check a SignalForge ACA app endpoint.

Usage:
  bash scripts/check-aca-app.sh [options] <base-url>

Options:
  --admin-token VALUE   Optional admin token for authenticated /api/sources checks
  --timeout VALUE       Curl timeout in seconds (default: ACA_CHECK_TIMEOUT_SECONDS or 20)
  -h, --help            Show this help

Examples:
  bash scripts/check-aca-app.sh https://ca-signalforge.<aca-default-domain>
  SIGNALFORGE_ADMIN_TOKEN=replace-me bash scripts/check-aca-app.sh https://ca-signalforge.<aca-default-domain>
EOF
}

pretty_print() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-token)
      ADMIN_TOKEN="${2:?missing value after $1}"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SECONDS="${2:?missing value after $1}"
      shift 2
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      BASE_URL="$1"
      shift
      ;;
  esac
done

if [[ -z "$BASE_URL" ]]; then
  echo "error: base URL is required" >&2
  echo "Try: $0 --help" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"

echo "Checking ${BASE_URL}/api/health"
health_payload="$(curl -fsS --max-time "${TIMEOUT_SECONDS}" "${BASE_URL}/api/health")"
printf '%s\n' "$health_payload" | pretty_print

echo
echo "Checking ${BASE_URL}/api/runs"
runs_payload="$(curl -fsS --max-time "${TIMEOUT_SECONDS}" "${BASE_URL}/api/runs")"
printf '%s\n' "$runs_payload" | pretty_print

if [[ -n "$ADMIN_TOKEN" ]]; then
  echo
  echo "Checking ${BASE_URL}/api/sources"
  sources_payload="$(curl -fsS --max-time "${TIMEOUT_SECONDS}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    "${BASE_URL}/api/sources")"
  printf '%s\n' "$sources_payload" | pretty_print
else
  echo
  echo "Skipping /api/sources check because no admin token was supplied."
fi
