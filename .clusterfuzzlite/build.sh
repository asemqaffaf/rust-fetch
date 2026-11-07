#!/bin/bash -eu
# The six cargo-fuzz targets in wasm-module/fuzz, built with the image's nightly toolchain and sanitizer flags
cd "$SRC/rust-fetch/wasm-module"
cargo fuzz build -O --debug-assertions
for target in sse lines retry_after urls headers multipart; do
  cp "fuzz/target/x86_64-unknown-linux-gnu/release/$target" "$OUT/$target"
  zip -qj "$OUT/${target}_seed_corpus.zip" fuzz/corpus/"$target"/*
done
