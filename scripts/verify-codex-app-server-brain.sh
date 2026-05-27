#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Run a local Codex App Server brain-provider verification against a checked-in fixture.

This validates SignalForge's analyzer brain path only:
deterministic fixture parsing -> local codex app-server stdio turn -> strict JSON report.

It does not inspect the current host and does not assume the machine is Linux or WSL.

Usage:
  bash scripts/verify-codex-app-server-brain.sh [options]

Options:
  --fixture <path>       Fixture to analyze (default: tests/fixtures/sample-prod-server.log)
  --model <model>        Codex model id (default: gpt-5.4 or CODEX_APP_SERVER_MODEL)
  --timeout-ms <ms>      Turn timeout in milliseconds (default: 120000)
  --command <argv>       Codex App Server command (default: codex app-server)
  --output <path>        Write raw analyzer JSON to this path instead of a temp file
  -h, --help             Show this help

Examples:
  bash scripts/verify-codex-app-server-brain.sh
  bash scripts/verify-codex-app-server-brain.sh --fixture tests/fixtures/wsl-nov2025-truncated.log
EOF
}

FIXTURE="tests/fixtures/sample-prod-server.log"
MODEL="${CODEX_APP_SERVER_MODEL:-gpt-5.4}"
TIMEOUT_MS="${CODEX_APP_SERVER_TURN_TIMEOUT_MS:-120000}"
COMMAND="${CODEX_APP_SERVER_COMMAND:-codex app-server}"
OUTPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fixture)
      FIXTURE="${2:-}"
      shift 2
      ;;
    --model)
      MODEL="${2:-}"
      shift 2
      ;;
    --timeout-ms)
      TIMEOUT_MS="${2:-}"
      shift 2
      ;;
    --command)
      COMMAND="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$FIXTURE" ]]; then
  echo "error: fixture not found: $FIXTURE" >&2
  exit 2
fi

if [[ -z "$OUTPUT" ]]; then
  OUTPUT="$(mktemp "${TMPDIR:-/tmp}/signalforge-codex-brain-verification.XXXXXX")"
fi

export LLM_PROVIDER=codex_app_server
export CODEX_APP_SERVER_TRANSPORT=stdio
export CODEX_APP_SERVER_COMMAND="$COMMAND"
export CODEX_APP_SERVER_MODEL="$MODEL"
export CODEX_APP_SERVER_TURN_TIMEOUT_MS="$TIMEOUT_MS"

bun run analyze "$FIXTURE" > "$OUTPUT"

node - "$OUTPUT" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const raw = fs.readFileSync(file, "utf8");
const jsonStart = raw.indexOf("{");
if (jsonStart < 0) {
  console.error(`error: analyzer output did not contain JSON: ${file}`);
  process.exit(1);
}

const result = JSON.parse(raw.slice(jsonStart));
const meta = result.meta ?? {};
const findings = Array.isArray(result.report?.findings) ? result.report.findings : [];

console.log(`output=${file}`);
console.log(`llm_succeeded=${meta.llm_succeeded === true}`);
console.log(`model_used=${meta.model_used ?? ""}`);
console.log(`tokens_used=${meta.tokens_used ?? 0}`);
console.log(`duration_ms=${meta.duration_ms ?? 0}`);
console.log(`findings=${findings.length}`);
if (result.analysis_error) console.log(`analysis_error=${result.analysis_error}`);

if (meta.llm_succeeded !== true) {
  console.error("error: Codex App Server brain verification fell back to deterministic-only output");
  process.exit(1);
}
if (typeof meta.model_used !== "string" || !meta.model_used.startsWith("codex-app-server:")) {
  console.error(`error: unexpected model_used: ${meta.model_used}`);
  process.exit(1);
}
NODE
