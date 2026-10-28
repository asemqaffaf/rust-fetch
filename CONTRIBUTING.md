# Contributing to rust-fetch

Thanks for helping. This guide covers the development setup, what a pull request needs, and how releases are cut.

Everyone participating in the project is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Ways to help

Documentation corrections, minimal bug reproductions, tests, and compatibility reports are welcome alongside code changes. Read the [guide](https://asemqaffaf.github.io/rust-fetch/guide/) and [roadmap](https://github.com/asemqaffaf/rust-fetch/blob/main/ROADMAP.md) to find an area to work on. For a larger change, open an issue first so we can agree on its scope.

Use the [issue forms](https://github.com/asemqaffaf/rust-fetch/issues/new/choose) for bugs and feature requests. Include the rust-fetch version, runtime, and a reproduction without credentials or private data. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Setup

You need:
- Rust (stable) with the `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- [wasm-pack](https://rustwasm.github.io/wasm-pack/)
- Node.js 20+
- Optional, for coverage: [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov)

```bash
npm run build      # build the npm package into wasm-module/pkg
npm run build:native  # build the native Node.js transport next to it (optional)
npm test           # Rust unit + integration tests, then the JS tests
cd wasm-module && wasm-pack test --node   # wasm tests for the JS bindings
```

[Development and benchmarking](https://asemqaffaf.github.io/rust-fetch/development) in the docs describes each test suite.

## Pull requests

- Branch from `main` (or from `v1.x` for a 1.x fix) and open the PR against that branch.
- Add tests for every behaviour change. CI fails if line or function coverage of the Rust core (`src/` outside `src/wasm/` and `src/http.rs`) drops below 100%. JS-facing code needs wasm tests (`src/wasm/tests.rs`) or JS tests (`wasm-module/js/test/`).
- Tests must not use the internet. Use the local test servers in `tests/integration_tests.rs` and `js/test/helpers.mjs`.
- Update the documentation in [`docs/`](https://github.com/asemqaffaf/rust-fetch/tree/main/docs) for user-visible changes (and the README, if the overview, quick start or comparison changes), and add an entry under `## [Unreleased]` in [CHANGELOG.md](https://github.com/asemqaffaf/rust-fetch/blob/main/CHANGELOG.md). `cd docs && npm install && npm run dev` previews the site; `npm run build` builds it and checks every link.
- Run `cargo fmt` on Rust changes.

CI also enforces these gates on every PR:

| Gate | Command | Fails when |
| --- | --- | --- |
| Dependency audit | `cd wasm-module && cargo deny check`, and `cargo deny --manifest-path native/Cargo.toml --config wasm-module/deny.toml check` | A dependency has a security advisory, a license not allowed in `deny.toml`, or comes from an unknown source |
| JavaScript dependency audit | `npm audit --package-lock-only --audit-level=low` in the root, `docs/`, and `examples/` | A locked dependency has a known vulnerability, including development dependencies, or the registry audit cannot complete |
| Native transport lints | `cd native && cargo fmt --check && cargo clippy --release -- -D warnings` | The native transport isn't formatted or has a clippy warning |
| Rust API compatibility | `cargo semver-checks --manifest-path wasm-module/Cargo.toml --baseline-rev main` | The Rust API changes in a way the version number doesn't allow |
| TypeScript API snapshot | `npm run api:check` | The published `.d.ts` differs from `api/rust-fetch.d.ts`. If the change is intended, run `npm run api:update` and commit the snapshot. |
| Node transport coverage | `npm run coverage:js` | Line or function coverage of the Node.js transport (`js/node.js`) drops below 100% |
| Size budget | `npm run size` | The `.wasm` or JS files outgrow the budgets in `scripts/check-size.mjs` |

`api:check`, `size` and `coverage:js` need a fresh `npm run build`. The JS tests run against the native transport too when `npm run build:native` has been run; without it they test the node:http transport only.

## Versioning

rust-fetch follows [Semantic Versioning](https://semver.org/). These count as **breaking** and need a new major version:
- removing or renaming an export, method, option or field
- changing a response shape, error kind or default (e.g. the timeout or retry policy)
- raising the minimum Node.js version
- removing a package `exports` path

When unsure, treat it as breaking.

## Branches and tags

| Ref | Purpose |
| --- | --- |
| `main` | Latest major version (2.x). Default branch; every change lands through a PR. |
| `v1.x` | Maintenance for 1.x: security and critical fixes only |
| `release/X.Y.Z` | Prepares a release (version bump, changelog), merged into its target branch |
| `vX.Y.Z` tags | One per published version, on the commit that was published |

Fixes that also apply to an older major version are made on `main` first, then cherry-picked into `v1.x`.

## Releasing

1. On a `release/X.Y.Z` branch, set the version in `wasm-module/Cargo.toml` and `package.json`. Then move the `Unreleased` changelog entries under `## [X.Y.Z] - YYYY-MM-DD`.
2. Merge the PR once CI passes.
3. Tag the merge commit and push the tag:
   ```bash
   git tag -a vX.Y.Z -m "rust-fetch X.Y.Z"
   git push origin vX.Y.Z
   ```
4. The [release workflow](https://github.com/asemqaffaf/rust-fetch/blob/main/.github/workflows/release.yml) then:
   - builds and tests the package
   - checks that the tag matches the package version
   - publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements)
   - creates a GitHub release

   Versions from an older major (e.g. 1.x while 2.x is current) are published under the `v<major>` dist-tag, so they don't replace `latest`.

Publishing needs either [trusted publishing](https://docs.npmjs.com/trusted-publishers) configured on npmjs.com for this repository and the `release.yml` workflow (preferred: no long-lived token), or an `NPM_TOKEN` repository secret. Release notes are taken from the version's CHANGELOG section. If a run fails after publishing (e.g. creating the GitHub release), re-run it: an already-published version is skipped.
