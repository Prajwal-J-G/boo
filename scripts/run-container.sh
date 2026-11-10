#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

port="${SITE_PORT:-5173}"
image="our-always-local:dev"

if [[ -n "${CONTAINER_ENGINE:-}" ]]; then
  engine="$CONTAINER_ENGINE"
elif command -v docker >/dev/null 2>&1; then
  docker_version="$(docker --version 2>/dev/null || true)"
  if [[ "$docker_version" == *podman* ]] && command -v podman >/dev/null 2>&1; then
    engine=podman
  else
    engine=docker
  fi
elif command -v podman >/dev/null 2>&1; then
  engine=podman
else
  printf 'Install Docker or Podman, then retry.\n' >&2
  exit 1
fi

command -v "$engine" >/dev/null 2>&1 || { printf 'Container engine not found: %s\n' "$engine" >&2; exit 1; }

printf 'Building the local preview image with %s...\n' "$engine"
"$engine" build -f Dockerfile.dev -t "$image" .

run_args=(run --rm --interactive --tty --name our-always-local-preview -p "127.0.0.1:${port}:5173")
if [[ "$engine" == podman ]] && [[ -x /usr/bin/crun ]]; then
  run_args+=(--runtime /usr/bin/crun)
fi

printf 'Opening http://127.0.0.1:%s/ (press Ctrl+C to stop).\n' "$port"
exec "$engine" "${run_args[@]}" "$image"