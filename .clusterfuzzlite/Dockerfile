# ClusterFuzzLite build image (#231): the six cargo-fuzz targets in wasm-module/fuzz
FROM gcr.io/oss-fuzz-base/base-builder-rust@sha256:2216f0ac0a289a0e8974917779c3f744c354067dd81e0c8f2fc53bc1a9a573db
COPY . $SRC/rust-fetch
COPY .clusterfuzzlite/build.sh $SRC/
WORKDIR $SRC/rust-fetch
