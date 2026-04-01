#!/usr/bin/env bash
# Fetch run detail, report, or compare/drift JSON from SignalForge (read-only; no submit).
# Uses GET /api/runs/[id], /report, /compare — see README and docs/external-submit.md.
set -euo pipefail

BASE_URL="${SIGNALFORGE_BASE_URL:-${SIGNALFORGE_URL:-http://localhost:3000}}"

show_help() {
  cat <<'EOF'
Read SignalForge run data as JSON (stdout). For submitting logs, use scripts/analyze.sh.

Usage:
  ./scripts/signalforge-read.sh [--url|-u BASE] <command> [args]

Commands:
  run <run-id>              GET /api/runs/[id] (metadata, embedded report, links)
  report <run-id>           GET /api/runs/[id]/report (audit report JSON only)
  compare <run-id> [--against <other-run-id>]   GET /api/runs/[id]/compare (drift)

Options:
  --url, -u BASE   API base URL (default: SIGNALFORGE_BASE_URL or SIGNALFORGE_URL, then http://localhost:3000)
  -h, --help       Show this help

Environment:
  SIGNALFORGE_BASE_URL
  SIGNALFORGE_URL

Exit codes:
  0 — HTTP 200, JSON printed to stdout
  1 — HTTP non-200, connection error, or bad usage
EOF
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

case "${CMD}" in
  "")
    echo "usage: $0 [--url|-u BASE] <run|report|compare> ..." >&2
    echo "Try: $0 --help" >&2
    exit 1
    ;;
  run|report|compare)
    ;;
  *)
    echo "error: unknown command: ${CMD}" >&2
    echo "Try: $0 --help" >&2
    exit 1
    ;;
esac

RUN_ID="${1:-}"
if [[ -z "$RUN_ID" ]]; then
  echo "usage: $0 [--url|-u BASE] ${CMD} <run-id> ..." >&2
  exit 1
fi
shift || true

AGAINST=""
if [[ "$CMD" == "compare" ]]; then
  if [[ "${1:-}" == --against ]]; then
    AGAINST="${2:-}"
    if [[ -z "$AGAINST" ]]; then
      echo "error: missing value after --against" >&2
      exit 1
    fi
    shift 2
  fi
  if [[ $# -gt 0 ]]; then
    echo "error: unexpected arguments: $*" >&2
    exit 1
  fi
else
  if [[ $# -gt 0 ]]; then
    echo "error: unexpected arguments: $*" >&2
    exit 1
  fi
fi

BASE="${BASE_URL%/}"
URL="${BASE}/api/runs/${RUN_ID}"
case "$CMD" in
  run) ;;
  report) URL="${URL}/report" ;;
  compare)
    URL="${URL}/compare"
    [[ -n "$AGAINST" ]] && URL="${URL}?against=${AGAINST}"
    ;;
esac

tmp="$(mktemp)"
# shellcheck disable=SC2064
trap 'rm -f "$tmp"' EXIT

http_code=$(curl -sS -o "$tmp" -w "%{http_code}" "$URL") || {
  echo "error: request failed (${URL})" >&2
  exit 1
}

cat "$tmp"

if [[ "$http_code" != "200" ]]; then
  echo "signalforge-read: HTTP ${http_code} (expected 200) — ${URL}" >&2
  exit 1
fi
