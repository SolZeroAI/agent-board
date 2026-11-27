#!/usr/bin/env bash
set -euo pipefail
corepack enable || true
if ! command -v nub >/dev/null 2>&1; then
  npm install -g @nubjs/nub@0.10.0
fi
nub install --frozen-lockfile
