#!/usr/bin/env bash
# `npm run build` for CI, retrying only when wasm-pack could not download one of its tools.
#
# wasm-pack fetches wasm-opt (binaryen) from GitHub releases on every fresh runner. When that download
# fails (HTTP 5xx from GitHub's release CDN, seen on 2026-11-08), the build fails although nothing in
# the repository is wrong. This retries those failures with a growing pause and nothing else: any other
# failure (a compile error, a test, a size budget) stops at once with its own exit code, and the build
# that finally succeeds is the same build, so the published Wasm does not change.
set -u
log=$(mktemp)
attempts=5
for attempt in $(seq 1 "$attempts"); do
  npm run build 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if ! grep -q 'failed to download' "$log"; then
    exit "$status"
  fi
  echo "::warning::wasm-pack could not download a tool (attempt $attempt of $attempts)"
  if [ "$attempt" -lt "$attempts" ]; then
    sleep $((attempt * ${RETRY_PAUSE:-20}))
  fi
done
exit 1
