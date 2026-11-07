# ClusterFuzzLite build image (#231): the six cargo-fuzz targets in wasm-module/fuzz
FROM gcr.io/oss-fuzz-base/base-builder-rust
COPY . $SRC/rust-fetch
COPY .clusterfuzzlite/build.sh $SRC/
WORKDIR $SRC/rust-fetch
