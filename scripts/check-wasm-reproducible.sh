#!/usr/bin/env bash
# The Wasm in a release must be what the source builds to (#232). Builds the tracked tree twice, in two
# different directories, and fails unless both give the same bytes. With COMPARE_WORKSPACE=1, the wasm already
# built in wasm-module/pkg (the release job) must match too, so the file that is published is the
# file that rebuilds. Used by .github/workflows/reproducible.yml and release.yml; needs wasm-pack on PATH.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

hash_of() { sha256sum "$1" | cut -d' ' -f1; }

build() {
  mkdir -p "$1"
  git -C "$root" archive HEAD | tar -x -C "$1"
  rm -rf "$1/wasm-module/pkg" "$1/wasm-module/target"
  (cd "$1/wasm-module" && wasm-pack build --release --target web >/dev/null 2>&1)
  hash_of "$1/wasm-module/pkg/rust_fetch_bg.wasm"
}

first=$(build "$work/first")
second=$(build "$work/second")
echo "first  build ($work/first):  $first"
echo "second build ($work/second): $second"

status=0
test -n "$first" && test "$first" = "$second" || { echo "::error::two builds of the same source gave different Wasm"; status=1; }

built="$root/wasm-module/pkg/rust_fetch_bg.wasm"
if [ -f "$built" ] && [ "${COMPARE_WORKSPACE:-}" = 1 ]; then
  workspace=$(hash_of "$built")
  echo "workspace build ($built): $workspace"
  test "$workspace" = "$first" || { echo "::error::the Wasm built in the workspace is not what a clean build of the source gives"; status=1; }
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Wasm builds"
    echo "| Build | sha256 |"
    echo "| --- | --- |"
    echo "| first, clean tree | \`$first\` |"
    echo "| second, other directory | \`$second\` |"
    [ -n "${workspace:-}" ] && echo "| workspace (to be published) | \`$workspace\` |"
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit "$status"
