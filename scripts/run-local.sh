#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Node.js and npm are required. Install Node.js 20.19+ or 22.12+, then retry.\n' >&2
  exit 1
fi

if [[ ! -x node_modules/.bin/vite ]]; then
  printf 'Installing project dependencies from package-lock.json...\n'
  npm ci
fi

printf 'Starting the local preview on this computer only.\n'
exec npm run dev -- --host 127.0.0.1