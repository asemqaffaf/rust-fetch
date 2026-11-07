# OSS-Fuzz project files (#231)

`project.yaml`, `Dockerfile` and `build.sh` are the files OSS-Fuzz needs to run the six targets in `../fuzz_targets` continuously. They are kept here so the project can apply without writing them from scratch.

**Status: not submitted, not run.** OSS-Fuzz accepts a project through a pull request to [google/oss-fuzz](https://github.com/google/oss-fuzz) that adds these three files under `projects/rust-fetch/`, reviewed by its maintainers, who also decide whether a project is accepted. Before submitting, check them with OSS-Fuzz's own tooling:

```sh
python infra/helper.py build_image rust-fetch
python infra/helper.py build_fuzzers --sanitizer address rust-fetch
python infra/helper.py check_build rust-fetch
```

Until then, `.github/workflows/fuzz.yml` runs the same targets daily with a corpus that persists between runs.
