#!/usr/bin/env bash
set -euo pipefail

# Vercel is preview/review only for SignalForge.
# ACA is the real app-hosting path, so skip production builds on Vercel.
if [[ "${VERCEL_ENV:-}" == "production" ]]; then
  echo "Skipping Vercel production build, ACA is the live deployment path."
  exit 0
fi

base_ref=""
if git show-ref --verify --quiet refs/remotes/origin/main; then
  base_ref="$(git merge-base HEAD origin/main)"
elif git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  base_ref="HEAD^"
else
  echo "No merge base available, allowing preview build."
  exit 1
fi

# Only build previews when files that affect the Vercel-rendered app changed.
if git diff --quiet "${base_ref}" HEAD -- \
  src \
  middleware.ts \
  next.config.ts \
  package.json \
  bun.lock \
  postcss.config.js \
  tsconfig.json \
  tsconfig.typecheck.json \
  next-env.d.ts \
  vercel.json \
  scripts/vercel-ignore-build.sh
then
  echo "No preview-relevant changes, skipping Vercel build."
  exit 0
fi

echo "Preview-relevant changes detected, allowing Vercel build."
exit 1
