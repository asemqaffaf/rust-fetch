# 2.7 performance follow-up: #180 and #181

Local measurements on 2026-11-02, Apple M1 Pro, Node.js 22.23.3, Rust 1.99.1, wasm-pack 0.13.1, Darwin 25.6.0. These initial compact-entry samples were captured at `f6689a8`, before the request-registry completion follow-up. They are unreleased changes on top of the security-hardened 2.7.0; the package version remains 2.7.0 until a separate patch release is prepared. These measurements were collected before CI. Current validation is tracked in [startup PR #203](https://github.com/asemqaffaf/rust-fetch/pull/203) and [native PR #204](https://github.com/asemqaffaf/rust-fetch/pull/204).

The [full comparison](comparison.md) uses the existing benchmark unchanged: seven interleaved rounds, 1.5 seconds each, fresh processes and the same local server. Against 2.6.1, default client overhead is level, node:http startup is 3.7% slower (15.2 vs 14.7 ms), and native concurrent throughput is 2.6% lower (33,291 vs 34,170 requests/s). The strict 10% regression threshold is unchanged. Native startup remains 7.7% slower. Browser bundle growth from the 2.7 features is still present; these changes do not establish zero overhead for every feature or workload.

An earlier focused run with the same worker includes the security-hardened 2.7.0 as a third build. Its [raw samples](native-samples.json) show native concurrency at 30,549 requests/s before and 32,737 after (+7.2%), against 33,737 for 2.6.1 (-3.0%). It rotates the three builds in each of seven rounds. The independent full run above confirms the improvement; absolute rates vary between runs.

The separate [packed-artifact check](packed-comparison.md) also passed the unchanged strict gate against npm 2.6.1: startup +3.0%, instant-transport overhead +1.0%, and no regression beyond the threshold. It packs and clean-installs the candidate, checks its contents, runs the smoke/security tests and benchmarks the installed tarball. Nothing was published.

## Linux follow-up

Nine interleaved diagnostic rounds on Node.js 22.23.4, Intel Xeon Platinum 8370C / Linux, with Rust 1.99.1 native builds: [run and profiles](https://github.com/asemqaffaf/rust-fetch/actions/runs/41477977011), [raw unprofiled samples](linux-native-samples.json). Each build runs for two seconds in a fresh process after warmup; build order rotates every round. No tests or builds run in parallel with the measurements. Labels below match the samples.

| Build | Median requests/s | Versus 2.6.1 | Median user CPU, µs/request |
| --- | ---: | ---: | ---: |
| `historical`: published 2.6.1 + rebuilt addon | 13,517 | — | 95.1 |
| `patched`: published 2.6.2 + rebuilt addon | 12,319 | -8.9% | 103.6 |
| `completion`: compact entry + JS-thread cleanup (`65b3f3c`) | 11,775 | -12.9% | 109.9 |
| `headers`: guarded ordinary response-header properties | 12,437 | -8.0% | 104.9 |
| `cold`: headers + separately allocated connection handshakes | 12,938 | -4.3% | 100.6 |

The final diagnostic reduces the measured gap to 4.3% by the existing benchmark's ratio-of-medians method, improves throughput 9.9% over `completion`, and is 5.0% faster than security-patched 2.6.2. Results are noisy: the median of per-round differences versus 2.6.1 is -7.6%, and the candidate loses seven of nine paired rounds. This is evidence of improvement, not proof that every Linux runner meets the 5% target. Historical comparisons remain in PR CI, and #181 stays open until the fix is accepted and merged.

The 2.6.2 control contains the earlier prototype-pollution backport while retaining 2.6.1's native request/pool implementation. Its 8.9% gap in this run shows why removing security hardening is not an acceptable route to the old baseline. It does not cover every 2.7 security change (notably per-module TLS/cancellation scope isolation).

The handshake change keeps TCP/TLS state off the reused-connection path without changing TLS verification, pool bounds, timeouts or cancellation. Rust type-layout diagnostics shrink `Transport::exchange` from 4,944 to 1,304 bytes, `Transport::send` from 6,856 to 3,216 bytes, and `send_attempt` from 7,336 to 3,696 bytes. Only new/replacement connections allocate the handshake future. Response headers remain ordinary public objects; inherited collisions use a prototype-free data-property descriptor and repeated headers still join in wire order.

These diagnostic assets precede the descriptor-hardening follow-up, which adds 16 Wasm bytes. Final-source validation and historical performance are reported by [PR #204 CI](https://github.com/asemqaffaf/rust-fetch/pull/204/checks). The cache-padding experiment was discarded because it showed no useful improvement.

## Reproduce

Build both the historical baseline and the candidate with Rust 1.99.1. Install `rust-fetch@2.6.1` in a temporary directory for its published Wasm/JS assets, then build its native addon from tag `v2.6.1` and copy that binary alongside its `node.js`. The npm package alone has no addon and cannot measure native throughput. Build the candidate with `npm run build` and `npm run build:native`.

```sh
BENCH_ROUNDS=7 BENCH_SECONDS=1.5 BENCH_STRICT=1 node benchmarks/compare.mjs /path/to/2.6.1/pkg wasm-module/pkg
node scripts/check-package.mjs --strict --baseline 2.6.1
```

Run without other test/build workloads competing for CPU. The Node transports enforce the same security controls; requests with optional native policies retain the full entry. Local addons require private wire v6; stale binaries fall back to node:http.

## Initial local verification

- 636 JavaScript tests: 628 passed, 8 intentional skips, including all 97 security/hardening/prototype-pollution tests on both Node transports.
- 72 real-browser tests: 68 passed, 4 intentional skips; 69 conformance behaviors across six adapters, 414 expected observations.
- Rust unit/integration/doc tests and 32 Wasm binding tests passed; two new native tests check header defaults and preservation of caller values/repeats.
- Node transport coverage: 100% lines and functions; 2,000 deterministic JS/Wasm fuzz cases without traps.
- Native clippy, formatting, API snapshot and package size checks passed. Only the Node shim budget grows (59.8/19.2/16.8 kB raw/gzip/brotli); Wasm/shared-JS budgets are unchanged.
