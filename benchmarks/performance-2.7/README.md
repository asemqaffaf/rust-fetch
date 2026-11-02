# 2.7 performance follow-up: #180 and #181

Local measurements on 2026-11-02, Apple M1 Pro, Node.js 22.23.3, Rust 1.99.1, wasm-pack 0.13.1, Darwin 25.6.0. These are unreleased changes on top of the security-hardened 2.7.0; the package version remains 2.7.0 until a separate patch release is prepared. CI has not run on this branch.

The [full comparison](comparison.md) uses the existing benchmark unchanged: seven interleaved rounds, 1.5 seconds each, fresh processes and the same local server. Against 2.6.1, default client overhead is level, node:http startup is 3.7% slower (15.2 vs 14.7 ms), and native concurrent throughput is 2.6% lower (33,291 vs 34,170 requests/s). The strict 10% regression threshold is unchanged. Native startup remains 7.7% slower. Browser bundle growth from the 2.7 features is still present; these changes do not establish zero overhead for every feature or workload.

An earlier focused run with the same worker includes the security-hardened 2.7.0 as a third build. Its [raw samples](native-samples.json) show native concurrency at 30,549 requests/s before and 32,737 after (+7.2%), against 33,737 for 2.6.1 (-3.0%). It rotates the three builds in each of seven rounds. The independent full run above confirms the improvement; absolute rates vary between runs.

The separate [packed-artifact check](packed-comparison.md) also passed the unchanged strict gate against npm 2.6.1: startup +3.0%, instant-transport overhead +1.0%, and no regression beyond the threshold. It packs and clean-installs the candidate, checks its contents, runs the smoke/security tests and benchmarks the installed tarball. Nothing was published.

## Reproduce

Build both the historical baseline and the candidate with Rust 1.99.1. Install `rust-fetch@2.6.1` in a temporary directory for its published Wasm/JS assets, then build its native addon from tag `v2.6.1` and copy that binary alongside its `node.js`. The npm package alone has no addon and cannot measure native throughput. Build the candidate with `npm run build` and `npm run build:native`.

```sh
BENCH_ROUNDS=7 BENCH_SECONDS=1.5 BENCH_STRICT=1 node benchmarks/compare.mjs /path/to/2.6.1/pkg wasm-module/pkg
node scripts/check-package.mjs --strict --baseline 2.6.1
```

Run without other test/build workloads competing for CPU. The Node transports enforce the same security controls; requests with optional native policies retain the full entry. Local addons require private wire v6; stale binaries fall back to node:http.

## Verification

- 636 JavaScript tests: 628 passed, 8 intentional skips, including all 97 security/hardening/prototype-pollution tests on both Node transports.
- 72 real-browser tests: 68 passed, 4 intentional skips; 69 conformance behaviors across six adapters, 414 expected observations.
- Rust unit/integration/doc tests and 32 Wasm binding tests passed; two new native tests check header defaults and preservation of caller values/repeats.
- Node transport coverage: 100% lines and functions; 2,000 deterministic JS/Wasm fuzz cases without traps.
- Native clippy, formatting, API snapshot and package size checks passed. Only the Node shim budget grows (59.8/19.2/16.8 kB raw/gzip/brotli); Wasm/shared-JS budgets are unchanged.
