#!/usr/bin/env bash
set -euo pipefail

module_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$module_dir/../.." && pwd)"
output_dir="$module_dir/build"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

mkdir -p "$output_dir"
cd "$repo_root/backend"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o "$temp_dir/bootstrap" .
cd "$temp_dir"
zip -q "$output_dir/lambda.zip" bootstrap
printf 'Created %s\n' "$output_dir/lambda.zip"