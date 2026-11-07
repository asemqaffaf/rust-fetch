# Copy to projects/rust-fetch/ in google/oss-fuzz (see README.md in this directory)
FROM gcr.io/oss-fuzz-base/base-builder-rust
RUN git clone --depth 1 https://github.com/asemqaffaf/rust-fetch rust-fetch
WORKDIR rust-fetch
COPY build.sh $SRC/
