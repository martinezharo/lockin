#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

node scripts/check-release.mjs
node --test tests/*.test.mjs

version="$(node -p "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')).version")"
mkdir -p dist
archive="dist/lock-in-${version}-chrome-web-store.zip"

zip -X -FS -q -r "$archive" manifest.json icons fonts src env.example.js

# The development checkout uses an ignored env.js. The store package instead
# receives the committed, known-false template under the runtime filename.
zipnote "$archive" \
  | sed '/^@ env\.example\.js$/a @=env.js' \
  | zipnote -w "$archive"

entries="$(unzip -Z1 "$archive")"
if grep -q '^env\.example\.js$' <<<"$entries"; then
  echo 'Release archive still contains env.example.js' >&2
  exit 1
fi
if ! grep -q '^env\.js$' <<<"$entries"; then
  echo 'Release archive is missing the production env.js' >&2
  exit 1
fi
if ! unzip -p "$archive" env.js | grep -q 'LOCKIN_DEV = false'; then
  echo 'Production env.js does not disable dev mode' >&2
  exit 1
fi

sha256sum "$archive" > "$archive.sha256"
echo "Built $archive"
echo "SHA-256: $(cut -d ' ' -f1 "$archive.sha256")"
