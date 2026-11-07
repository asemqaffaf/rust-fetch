# Copy to projects/rust-fetch/ in google/oss-fuzz (see README.md in this directory)
FROM gcr.io/oss-fuzz-base/base-builder-rust@sha256:3428d0a90b1e7efbe2ba947bd1d0c9a70594986b4b6553804547f1fb24cfc92f
RUN git clone --depth 1 https://github.com/asemqaffaf/rust-fetch rust-fetch
WORKDIR rust-fetch
COPY build.sh $SRC/
