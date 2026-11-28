# Copy to projects/rust-fetch/ in google/oss-fuzz (see README.md in this directory)
FROM gcr.io/oss-fuzz-base/base-builder-rust@sha256:2216f0ac0a289a0e8974917779c3f744c354067dd81e0c8f2fc53bc1a9a573db
RUN git clone --depth 1 https://github.com/asemqaffaf/rust-fetch rust-fetch
WORKDIR rust-fetch
COPY build.sh $SRC/
