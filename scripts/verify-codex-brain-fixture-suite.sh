#!/usr/bin/env bash
set -euo pipefail

# Run Codex App Server brain verification across mandatory analyzer fixtures.
# Skips gracefully when `codex` is not installed.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v codex >/dev/null 2>&1; then
  echo "SKIP: codex not found in PATH; install Codex CLI to run live brain verification"
  exit 0
fi

FIXTURES=(
  tests/fixtures/sample-prod-server.log
  tests/fixtures/wsl-mar2026-full.log
  tests/fixtures/container-database-service.txt
  tests/fixtures/kubernetes-payments-bundle.json
  tests/fixtures/kubernetes-public-ingress-namespace.json
)

failures=0
for fixture in "${FIXTURES[@]}"; do
  echo "=== $fixture ==="
  if ! bash scripts/verify-codex-app-server-brain.sh --fixture "$fixture"; then
    failures=$((failures + 1))
  fi
  echo
done

if [[ "$failures" -gt 0 ]]; then
  echo "error: $failures fixture verification run(s) failed" >&2
  exit 1
fi

echo "All ${#FIXTURES[@]} fixture verification runs passed."
