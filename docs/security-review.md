# Independent security review

rust-fetch has not had an independent security review yet. Everything it claims about its own security is produced and judged by this repository's CI and its maintainer ([#223](https://github.com/asemqaffaf/rust-fetch/issues/223)). This page is an open call for human security researchers to review it, and says what a review can rely on.

What does not count as independent: CI, the fuzzers, the maintainer's own tests, and any AI-assisted review the maintainer runs. They find bugs, and are used for that, but they are not presented as a review by someone else.

## What to review

Six areas, in the order we would start:

| Area | Where | What to try to break |
| --- | --- | --- |
| URL and `baseUrl` resolution | `wasm-module/src/url.rs`, `wasm-module/src/wasm/url.rs` | A request that goes to an origin other than the one the application meant, through `//host`, backslashes, user info, dot segments, odd hosts or schemes. `allowAbsoluteUrls: false` and `baseUrl` are the boundary |
| Redirects and credential scoping | `wasm-module/js/node.js` (redirect handling), `native/src/` | A credential (`Authorization`, `Cookie`, `Proxy-Authorization`, `sensitiveHeaders`) sent to an origin other than the one it was given for, or a method and body kept or dropped against the Fetch rules |
| The SSRF guard and DNS handling | `allowPrivateNetwork: false`, `wasm-module/js/node.js`, `native/src/` | A request to a private, loopback, link-local or special-purpose address that is not refused: DNS rebinding, mixed A and AAAA answers, IPv6 embeddings, a proxy |
| The JavaScript glue | `wasm-module/js/`, `scripts/postbuild.mjs` | Prototype pollution, unsafe option handling, a value that reaches Node's `http`, `net` or `tls` from the prototype chain, and anything the browser build does that a strict Content Security Policy would block |
| The native addon and its unsafe boundary | `native/src/`, `wasm-module/src/wasm/alloc.rs` | Memory safety across the Node-API boundary, in cancellation and worker shutdown, and the one `unsafe` allocator listed in [`unsafe.md`](./unsafe.md) |
| The release pipeline | `.github/workflows/`, `scripts/` | A way to publish, alter or substitute what npm serves: provenance, the reproducible Wasm build, workflow permissions, pinned actions |

Out of scope: vulnerabilities in Node.js, browsers, undici, a proxy or the operating system; denial of service that needs more than the documented limits to be reached; and findings that need an application to disable a documented protection.

## Size

Physical lines at commit `33efb92` (2026-11-07), counted with `cat | wc -l`, so comments and blank lines are included. Lines that are neither blank nor a `//` comment are in brackets.

| Part | Lines |
| --- | --- |
| Rust core, `wasm-module/src/` | 14,783 (12,570) |
| Native Node addon, `native/src/` | 1,735 (1,523) |
| JavaScript, `wasm-module/js/` (`node.js`, `observability.js`, `upload.js`), excluding tests | 1,800 |
| Rust integration tests, `wasm-module/tests/` | 1,985 (1,738) |
| JavaScript tests, `wasm-module/js/test/` | 10,330 |

Dependencies are not counted: the Rust crates are pinned in the two `Cargo.lock` files, and the JavaScript package has no runtime dependencies.

## What we give you

- The [threat model](./threat-model): assets, attackers, trust boundaries per adapter, and the known gaps.
- The [claims table](./security#claims-and-the-tests-behind-them): every protection we state, with the test that checks it, so a claim without a test is easy to find.
- The test matrices: [URL resolution](./security#url-resolution-is-checked-against-the-whatwg-url-parser), redirects, TLS verification, hostile responses ([conformance matrix](https://github.com/asemqaffaf/rust-fetch/blob/main/CONFORMANCE.md)), the SSRF ranges, and the secret-leak canary.
- The [unsafe inventory](./unsafe), fuzz targets with seeds, Miri and AddressSanitizer in CI (the native addon included), and a reproducible Wasm build check.
- A guide to building and running everything: [development](./development).

## How to report

Report privately through a [GitHub Security Advisory](https://github.com/asemqaffaf/rust-fetch/security/advisories/new), as described in [SECURITY.md](https://github.com/asemqaffaf/rust-fetch/blob/main/SECURITY.md). Do not open a public issue for a vulnerability. A report that says "no findings" for an area, with what you tried, is as welcome as one with findings.

We acknowledge within 48 to 72 hours. Findings are fixed, backported to the supported lines, and disclosed on a date we agree with you. After disclosure we publish a summary of the review and its findings and link it from SECURITY.md, and credit you in the advisory and the summary unless you prefer not to be named.

This call does not offer payment. If you can review a whole area, or all of them, and want to agree a scope first, write to the maintainer at the address in SECURITY.md with the subject `[SECURITY REVIEW] rust-fetch`.

## Status

| | |
| --- | --- |
| Reviewer | None chosen yet |
| Scope | The six areas above |
| Funded review | An application to the Open Source Technology Improvement Fund is planned once the test matrices in [#235](https://github.com/asemqaffaf/rust-fetch/issues/235) are complete |
| Result | Not published; this page and SECURITY.md will link it |
