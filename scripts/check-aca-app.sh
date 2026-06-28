#!/usr/bin/env bash
# Verify a SignalForge ACA app endpoint.
set -euo pipefail

BASE_URL=""
TIMEOUT_SECONDS="${ACA_CHECK_TIMEOUT_SECONDS:-20}"
RETRIES="${ACA_CHECK_RETRIES:-3}"
RETRY_SLEEP_SECONDS="${ACA_CHECK_RETRY_SLEEP_SECONDS:-10}"
ADMIN_TOKEN="${SIGNALFORGE_ADMIN_TOKEN:-}"
RUNS_TOKEN="${SIGNALFORGE_RUNS_API_TOKEN:-}"
EXPECT_RUNS_AUTH="${SIGNALFORGE_RUNS_REQUIRE_AUTH:-${ACA_RUNS_REQUIRE_AUTH:-false}}"

show_help() {
  cat <<'EOF'
Verify a SignalForge ACA app endpoint.

Usage:
  bash scripts/check-aca-app.sh [options] <base-url>

Options:
  --admin-token VALUE   Optional admin token for authenticated /api/sources checks
  --runs-token VALUE    Optional runs API token for authenticated /api/runs checks
  --expect-runs-auth    Expect unauthenticated /api/runs to return HTTP 401
  --timeout VALUE       Curl timeout in seconds (default: ACA_CHECK_TIMEOUT_SECONDS or 20)
  --retries VALUE       Attempts per endpoint (default: ACA_CHECK_RETRIES or 3)
  --retry-sleep VALUE   Seconds between attempts (default: ACA_CHECK_RETRY_SLEEP_SECONDS or 10)
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

validate_positive_integer() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "error: ${name} must be a positive integer, got '${value}'" >&2
    exit 1
  fi
}

fetch_json_with_retries() {
  local label="$1"
  local url="$2"
  shift 2

  local attempt=1
  local payload=""
  while [[ "$attempt" -le "$RETRIES" ]]; do
    if [[ "$RETRIES" -gt 1 ]]; then
      echo "Checking ${url} (attempt ${attempt}/${RETRIES})" >&2
    else
      echo "Checking ${url}" >&2
    fi

    set +e
    payload="$(curl -fsS --connect-timeout 10 --max-time "${TIMEOUT_SECONDS}" "$@" "$url")"
    local rc=$?
    set -e

    if [[ "$rc" -eq 0 ]]; then
      printf '%s\n' "$payload"
      return 0
    fi

    echo "warning: ${label} check failed on attempt ${attempt}/${RETRIES} (curl exit ${rc})" >&2
    if [[ "$attempt" -lt "$RETRIES" ]]; then
      sleep "$RETRY_SLEEP_SECONDS"
    fi
    attempt=$((attempt + 1))
  done

  echo "error: ${label} check failed after ${RETRIES} attempts" >&2
  return 1
}

expect_status_with_retries() {
  local label="$1"
  local url="$2"
  local expected_status="$3"

  local attempt=1
  local status=""
  while [[ "$attempt" -le "$RETRIES" ]]; do
    if [[ "$RETRIES" -gt 1 ]]; then
      echo "Checking ${url} status ${expected_status} (attempt ${attempt}/${RETRIES})" >&2
    else
      echo "Checking ${url} status ${expected_status}" >&2
    fi

    set +e
    status="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time "${TIMEOUT_SECONDS}" "$url")"
    local rc=$?
    set -e

    if [[ "$rc" -eq 0 && "$status" == "$expected_status" ]]; then
      echo "${label} returned HTTP ${status} as expected"
      return 0
    fi

    echo "warning: ${label} status check got HTTP ${status:-curl-exit-${rc}} on attempt ${attempt}/${RETRIES}" >&2
    if [[ "$attempt" -lt "$RETRIES" ]]; then
      sleep "$RETRY_SLEEP_SECONDS"
    fi
    attempt=$((attempt + 1))
  done

  echo "error: ${label} did not return HTTP ${expected_status} after ${RETRIES} attempts" >&2
  return 1
}

is_truthy() {
  case "${1,,}" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-token)
      ADMIN_TOKEN="${2:?missing value after $1}"
      shift 2
      ;;
    --runs-token)
      RUNS_TOKEN="${2:?missing value after $1}"
      shift 2
      ;;
    --expect-runs-auth)
      EXPECT_RUNS_AUTH="true"
      shift
      ;;
    --timeout)
      TIMEOUT_SECONDS="${2:?missing value after $1}"
      shift 2
      ;;
    --retries)
      RETRIES="${2:?missing value after $1}"
      shift 2
      ;;
    --retry-sleep)
      RETRY_SLEEP_SECONDS="${2:?missing value after $1}"
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

validate_positive_integer "timeout" "$TIMEOUT_SECONDS"
validate_positive_integer "retries" "$RETRIES"
validate_positive_integer "retry-sleep" "$RETRY_SLEEP_SECONDS"

BASE_URL="${BASE_URL%/}"

echo "Checking ${BASE_URL}/api/health"
health_payload="$(fetch_json_with_retries "health" "${BASE_URL}/api/health")"
printf '%s\n' "$health_payload" | pretty_print

echo
echo "Checking ${BASE_URL}/api/runs"
run_headers=()
if [[ -n "$RUNS_TOKEN" ]]; then
  run_headers=(-H "Authorization: Bearer ${RUNS_TOKEN}")
elif [[ -n "$ADMIN_TOKEN" ]]; then
  run_headers=(-H "Authorization: Bearer ${ADMIN_TOKEN}")
fi

if [[ "${#run_headers[@]}" -gt 0 ]]; then
  runs_payload="$(fetch_json_with_retries "runs" "${BASE_URL}/api/runs" "${run_headers[@]}")"
elif is_truthy "$EXPECT_RUNS_AUTH"; then
  expect_status_with_retries "runs" "${BASE_URL}/api/runs" "401"
  runs_payload=""
else
  runs_payload="$(fetch_json_with_retries "runs" "${BASE_URL}/api/runs")"
fi
if [[ -n "$runs_payload" ]]; then
  printf '%s\n' "$runs_payload" | pretty_print
fi

if [[ -n "$ADMIN_TOKEN" ]]; then
  token_var="ADMIN_TOKEN"

  echo
  echo "Checking ${BASE_URL}/api/sources"
  sources_payload="$(fetch_json_with_retries "sources" "${BASE_URL}/api/sources" \
    -H "Authorization: Bearer ${!token_var}")"
  printf '%s\n' "$sources_payload" | pretty_print
else
  echo
  echo "Skipping /api/sources check because no admin token was supplied."
fi
