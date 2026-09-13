#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

node scripts/check-release.mjs
node --test tests/*.test.mjs

version="$(node -p "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')).version")"
mkdir -p dist
archive="dist/lock-in-${version}-chrome-web-store.zip"

zip -X -FS -q -r "$archive" manifest.json icons fonts src

sha256sum "$archive" > "$archive.sha256"
echo "Built $archive"
echo "SHA-256: $(cut -d ' ' -f1 "$archive.sha256")"
