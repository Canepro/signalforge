#!/usr/bin/env bash
# Run Postgres migrations plus storage parity tests against a local database.
# Prefers an explicit URL, otherwise detects a local Podman Postgres container.
set -euo pipefail

CONTAINER_NAME="${SIGNALFORGE_POSTGRES_CONTAINER:-signalforge-pg}"
DATABASE_URL_VALUE="${DATABASE_URL_TEST:-${DATABASE_URL:-}}"

show_help() {
  cat <<'EOF'
Run SignalForge Postgres migrations and storage parity tests against a local database.

Usage:
  ./scripts/run-postgres-parity-local.sh [options]

Options:
  --url VALUE         Explicit Postgres connection string to use for both DATABASE_URL and DATABASE_URL_TEST
  --container NAME    Podman container name to inspect when --url is not provided
  -h, --help          Show this help

Detection order:
  1. --url
  2. DATABASE_URL_TEST or DATABASE_URL from the current shell
  3. A running Podman container (default: signalforge-pg)

Environment:
  SIGNALFORGE_POSTGRES_CONTAINER   Override the default container name
  DATABASE_URL
  DATABASE_URL_TEST

Examples:
  bash scripts/run-postgres-parity-local.sh
  bash scripts/run-postgres-parity-local.sh --container signalforge-pg
  bash scripts/run-postgres-parity-local.sh --url postgres://signalforge:signalforge@127.0.0.1:5432/signalforge
EOF
}

mask_url() {
  printf '%s' "$1" | sed -E 's#(postgres(ql)?://[^:]+):[^@]+@#\1:***@#'
}

resolve_from_podman() {
  local name="$1"
  local status
  status="$(podman inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)"
  if [[ "$status" != "running" ]]; then
    return 1
  fi

  local port_line host_port user password database
  port_line="$(podman port "$name" 5432/tcp 2>/dev/null | head -n 1)"
  if [[ -z "$port_line" ]]; then
    return 1
  fi
  host_port="${port_line##*:}"
  user="$(podman inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$name" | sed -n 's/^POSTGRES_USER=//p' | head -n 1)"
  password="$(podman inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$name" | sed -n 's/^POSTGRES_PASSWORD=//p' | head -n 1)"
  database="$(podman inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$name" | sed -n 's/^POSTGRES_DB=//p' | head -n 1)"

  if [[ -z "$user" || -z "$password" || -z "$database" || -z "$host_port" ]]; then
    return 1
  fi

  printf 'postgres://%s:%s@127.0.0.1:%s/%s' "$user" "$password" "$host_port" "$database"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      DATABASE_URL_VALUE="${2:?missing value after $1}"
      shift 2
      ;;
    --container)
      CONTAINER_NAME="${2:?missing value after $1}"
      shift 2
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

if [[ -z "$DATABASE_URL_VALUE" ]]; then
  if ! command -v podman >/dev/null 2>&1; then
    echo "error: no DATABASE_URL/DATABASE_URL_TEST set and podman is not available for local detection" >&2
    exit 1
  fi
  DATABASE_URL_VALUE="$(resolve_from_podman "$CONTAINER_NAME" || true)"
fi

if [[ -z "$DATABASE_URL_VALUE" ]]; then
  echo "error: could not determine a Postgres URL" >&2
  echo "Provide --url, export DATABASE_URL_TEST, or run a local Podman container such as ${CONTAINER_NAME}." >&2
  exit 1
fi

echo "Using Postgres: $(mask_url "$DATABASE_URL_VALUE")"
echo "Running migrations..."
DATABASE_URL="$DATABASE_URL_VALUE" DATABASE_URL_TEST="$DATABASE_URL_VALUE" bun run db:migrate:postgres

echo "Running storage parity tests..."
DATABASE_URL="$DATABASE_URL_VALUE" DATABASE_URL_TEST="$DATABASE_URL_VALUE" bun run test:parity
