# Security policy

## Supported versions

Each active `2.x` release line receives security patch releases. General bug fixes and performance improvements land on the latest minor release line (`2.7.x`). Security backports for earlier `2.x` lines are published under dedicated npm dist-tags (`release-2.x`) so that `latest` never moves backwards and automated updates do not inadvertently downgrade packages.

| Version | Supported | Latest patch | Distribution tag | Notes |
| --- | --- | --- | --- | --- |
| 2.7.x | Yes | 2.7.2 | `latest` | Current release line. Receives feature updates, bug fixes, and security patches. |
| 2.6.x | Security fixes only | 2.6.2 | `release-2.6` | Backported security fixes only. |
| 2.5.x | Security fixes only | 2.5.3 | `release-2.5` | Backported security fixes only. |
| 2.4.x | Security fixes only | 2.4.2 | `release-2.4` | Backported security fixes only. |
| 2.3.x | Security fixes only | 2.3.1 | `release-2.3` | Backported security fixes only; partial fix for prototype pollution (see note below). |
| 2.2.x | Security fixes only | 2.2.1 | `release-2.2` | Backported security fixes only; partial fix for prototype pollution (see note below). |
| 2.1.x | Security fixes only | 2.1.2 | `release-2.1` | Backported security fixes only; partial fix for prototype pollution (see note below). |
| 2.0.x | No | 2.0.0 | — | End of life. Node.js requests use built-in `fetch()` and cannot be shielded from prototype pollution in-package. Upgrade to >= 2.1.2 (or >= 2.4.2 for streaming). |
| 1.x | No | 1.1.0 | — | End of life. Uses runtime built-in `fetch()`; cannot be shielded against prototype pollution. Upgrade to >= 2.1.2. |
| < 1.0 | No | 0.7.2 | — | End of life. |

> [!NOTE]
> **Partial prototype-pollution fixes in 2.1.x–2.3.x:** In versions 2.1.x through 2.3.x, `responseType: 'stream'` (and `'ndjson'` in 2.3) and upload-progress requests are dispatched through Node's built-in `fetch()`. The built-in `fetch()` implementation reads `dispatcher`, `method`, `headers`, `body`, and `signal` from the prototype chain and cannot be shielded from inside the package. Those specific streaming and upload requests remain exposed in 2.1.2, 2.2.1, and 2.3.1; all other request paths are secured. Versions 2.4.0 and later handle these requests using `node:http`. Applications using streaming or progress callbacks should update to `>= 2.4.2` or `>= 2.7.1`.

## Reporting a vulnerability

Please don't open a public issue. Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/asemqaffaf/rust-fetch/security/advisories/new).

If you are unable to use GitHub Security Advisories, contact the maintainer directly at [asem@qaffaf.com](mailto:asem@qaffaf.com) with the subject `[SECURITY] rust-fetch`.

Please include:
- The affected `rust-fetch` version(s).
- Your runtime environment (Node.js version, browser, operating system, and whether the optional native addon is in use).
- A description of the vulnerability and its potential impact.
- A minimal reproduction script or steps without private credentials or sensitive production data.

You will receive an acknowledgement within 48 to 72 hours. Validated vulnerabilities are patched in private branches, reviewed against our test and benchmark gates, backported across all supported `2.x` release lines, and published simultaneously with a GitHub Security Advisory and CVE identifier.

## How security is handled and verified

Security fixes come before features in every release line. A fix ships with a regression test, and a protection is described in this file or the [security guide](https://asemqaffaf.github.io/rust-fetch/security) only while a test checks it: `claims.test.mjs` fails when a test named in the [claims table](https://asemqaffaf.github.io/rust-fetch/security#claims-and-the-tests-behind-them) no longer exists. Gaps are written down, not left out: see the known gaps in the [threat model](https://asemqaffaf.github.io/rust-fetch/threat-model), which lists what is not covered and why.

Automated checks, all in GitHub Actions:

| Check | What it covers |
| --- | --- |
| Tests and coverage on Node 20, 22 and 24 | The Wasm core, both Node transports, the native addon and the browser build, including hostile responses, redirects and credentials, the TLS matrix, the SSRF ranges and a secret-leak canary |
| `cargo-deny` and `npm audit` | Advisories, licenses and sources for Rust and JavaScript dependencies, on every change and weekly |
| CodeQL | JavaScript, TypeScript, Rust and workflow code |
| Workflow lint | Security lint of the workflow files themselves |
| Fuzzing | Parsers and the JavaScript boundary, with a corpus kept between runs, and a differential check of URL resolution against the WHATWG URL parser |
| Memory safety | `deny(unsafe_code)` in both crates; the only `unsafe` is the Wasm allocator, listed with its invariants in `docs/unsafe.md` and checked in CI; Miri and AddressSanitizer |
| Reproducible Wasm build | The published Wasm file is rebuilt and compared on pull requests that touch it |
| OpenSSF Scorecard | Repository and release practices, weekly |
| Release | npm provenance for every release, size, API and benchmark gates, and verification after publishing |

Not done yet: an independent security review (#223). Until one is published, the evidence above is the project's own.

See also the [threat model](https://asemqaffaf.github.io/rust-fetch/threat-model) (assets, trust boundaries and attackers per adapter) and the [Content Security Policy](https://asemqaffaf.github.io/rust-fetch/security#content-security-policy) section for the browser build.

## Security architecture and built-in protections

`rust-fetch` provides built-in defenses against common client-side and server-side network attacks. Detailed configuration examples are in the [Security Guide](https://asemqaffaf.github.io/rust-fetch/security), and what the library defends against and what it leaves to you is in the [threat model](https://asemqaffaf.github.io/rust-fetch/threat-model).

### Zero dependencies and supply-chain security

The published `rust-fetch` npm package has an entirely empty dependency manifest:

- **Dependencies (0):** Zero runtime npm dependencies. The entire client engine, WebAssembly runtime bridge, encoders, stream adapters, and protocols run without external packages. This eliminates transitive supply-chain risks, malicious dependency takeovers, dependency confusion, and prototype pollution primitives originating in third-party npm packages.
- **Dev Dependencies (0):** Zero development dependencies in the published tarball.
- **Zero lifecycle install scripts:** Contains no `preinstall`, `install`, or `postinstall` hooks. Package installation never executes arbitrary shell scripts or downloads untrusted external code.
- **Self-contained distribution:** Ships exclusively with the pre-compiled WebAssembly artifact, JavaScript bindings, TypeScript definitions, and policy documents. No Rust compiler, native toolchain, or external binary downloads are invoked on install.
- **Verifiable build provenance:** Every release is published with npm provenance attestations generated in pinned GitHub Actions environments, verifiable via `npm audit signatures`.

### Prototype pollution hardening (#191)

If another dependency or untrusted JSON input pollutes `Object.prototype`, `rust-fetch` protects its internal operations and request options:

- **Prototype-free internal state:** The Wasm-to-transport request bridge, Node `node:http` per-request state, upload trackers, diagnostics records, `RequestInit`, and WebSocket initialization objects are constructed with null prototypes (`Object.create(null)`).
- **Accessor safety (2.7.1):** Property descriptors used for URL request preparation, stream sources, and idempotency-key snapshots are prototype-free. Inherited `get` or `set` accessors cannot inject rogue behavior or cause descriptor operations to throw.
- **Option sanitization:** Plain options objects (at root and in nested policies such as `retries`, `retryBudget`, `circuitBreaker`, `rateLimit`, and WebSocket options) ignore inherited properties from `Object.prototype`. Custom instances with their own prototypes (e.g. shared client configurations) preserve inheritance.
- **Node.js transport options:** Options passed to Node's `http.request`, `net.connect`, and `tls.connect` explicitly define sensitive fields as own properties (`undefined` when not set) so Node internals do not fall back to prototype properties.
- **Mitigated attack vectors:** Prevents proxy hijacking (`proxy`), undici WebSocket dispatcher hijacking (`dispatcher`), custom CA certificate injection (`ca`), request body/signal/credential/path tampering, response header pollution, and `ReadableStream` constructor failures (`type`, `size`, `start`).

### SSRF prevention (`allowPrivateNetwork: false`)

When fetching user-supplied URLs on Node.js (webhooks, proxies, link previews), `allowPrivateNetwork: false` guards against Server-Side Request Forgery:

- **Connection-time validation:** Checks every resolved IP address at socket connection time and on every redirect, preventing DNS rebinding attacks.
- **Comprehensive address blocking:** Covers IPv4 loopback, RFC 1918 private, link-local (including the cloud metadata endpoint `169.254.169.254`), carrier-grade NAT, broadcast, and reserved ranges. Covers IPv6 loopback, link-local, site-local, unique-local, documentation, local-use NAT64 (`64:ff9b:1::/48`), and embedded IPv4 forms (IPv4-compatible `::a.b.c.d`, IPv4-mapped `::ffff:a.b.c.d`, IPv4-translated `::ffff:0:a.b.c.d`, 6to4 `2002::/16`, and Teredo `2001::/32`).
- **Proxy fail-closed enforcement (2.7.0):** Because HTTP/HTTPS forward proxies resolve hostnames on their remote end, hostnames cannot be verified locally. When `allowPrivateNetwork: false` is configured alongside a proxy, hostname targets are rejected immediately with a `NetworkError`; literal IP targets continue to be checked.
- **WebSocket coverage:** `client.websocket()` connections enforce private network restrictions on both initial handshakes and automatic reconnections via an isolated DNS-checked agent.

### Credential and redirect safety

- **Cross-origin credential stripping:** The Node.js transports automatically drop `Authorization`, `Cookie`, and `Proxy-Authorization` headers whenever a redirect leaves the original origin (different host, port, or protocol).
- **Custom sensitive headers:** List application-specific authentication headers (e.g. `X-Api-Key`, `X-Auth-Token`) in `sensitiveHeaders` to ensure they are also dropped on cross-origin redirects.
- **No protocol downgrade:** Configure `allowInsecureRedirects: false` to reject redirects from `https:` to `http:`.
- **Base URL encapsulation:** `allowAbsoluteUrls: false` prevents user-supplied URLs from overriding `baseUrl` and exfiltrating credentials to an attacker-controlled origin. Relative path traversal tricks (e.g. `//other.host`, `/\other.host`) remain locked to the base origin.
- **Header injection prevention:** Header names and values containing CR (`\r`) or LF (`\n`) characters are rejected immediately with `InvalidInputError` before transmission.

### Resource limits and load shedding

- **Response size limits (`maxResponseBytes`):** Enforces a strict ceiling on decompressed response bodies across Node.js and browser transports. Decompression of gzip, deflate, brotli, and zstd halts one byte past the limit, preventing decompression bombs from exhausting process memory.
- **Redirect body draining limit (2.5.2):** Followed redirect bodies are drained up to a maximum of 64 KiB; if a redirect body exceeds 64 KiB, the connection is closed immediately to prevent connection pool exhaustion and memory leaks.
- **Stream line and event limits (`maxLineBytes`, `maxEventBytes`):** Enforce byte limits on individual NDJSON lines and Server-Sent Event data blocks before buffering, preventing slow or malformed streams from consuming unbounded memory.
- **Load shedding (`maxPendingRequests`):** Rejects incoming requests immediately with a `NetworkError` once the client's concurrency ceiling is reached, preventing unbounded queue memory growth under sustained upstream overload.
- **WebSocket send queue limits (`maxQueuedMessages`, `maxQueuedBytes`):** Prevents buffer exhaustion when sending messages prior to connection establishment or during reconnects.
- **Phase timeouts:** Per-request and client-level granular timeouts (`connectTimeoutMs`, `responseTimeoutMs`, `idleTimeoutMs`, `deadlineMs`) prevent sockets from hanging indefinitely.

### Transport and worker isolation

- **Native adapter isolation (by design, not yet tested across threads):** Each native Node adapter is built to own its TLS configuration, connection pool, and cancellation scope, so that one worker thread cannot alter another thread's verification settings or cancel its requests. No test runs several worker threads against one addon yet; TLS trust is process-wide (`NODE_EXTRA_CA_CERTS`).
- **Thread-safe request cleanup (2.7.1):** Native request-ID cleanup completes synchronously on the owning JavaScript thread before promise resolution.
- **Raw response header parsing:** Response headers in Node.js are parsed from `rawHeaders` into null-prototype maps. Authentic headers named `__proto__` are preserved as data properties and cannot overwrite object prototypes.
- **Observability redaction:** Debug logging and lifecycle hooks redact userinfo, query strings, and sensitive headers, and keep response bodies out of hooks and logs (tested). Errors the client throws carry the request URL without its password and fragment (the password reads `***`), on the error and on every error in its `cause` chain; the query string stays unless you set `redactUrl`, which covers the whole chain (tested). Keep credentials out of URLs anyway, and redact errors before you log them.

## Distribution and release security

- **Dist-tags and release discipline:** The `latest` dist-tag on npm is strictly reserved for the current minor release line (`2.7.x`). Backported security patches for older release lines (`2.1.x`–`2.6.x`) are published to dedicated dist-tags (`release-2.1` through `release-2.6`) so that consumer dependencies using caret ranges (`^2.x`) will not unexpectedly downgrade.
- **Verify what you install:** in a project that has installed `rust-fetch`, run `npm audit signatures`. It checks the registry signature and the provenance attestation of every installed package that has one, and exits non-zero if either is invalid. `npm view rust-fetch@<version> dist.attestations` shows the attestation, whose source is this repository's `release.yml` workflow run for the tag `v<version>`. Provenance proves where a package was built, not that the source is free of defects, and it says nothing about the Wasm module's relation to the source. That is checked separately: the release workflow builds the Wasm twice in different directories and stops unless both builds and the file about to be published are identical, and `reproducible.yml` rebuilds the latest release's tag and compares it with the file on npm. To check it yourself, check out `v<version>`, build with the Rust and `wasm-pack` versions pinned in `release.yml` (`wasm-pack build --release --target web` in `wasm-module`), and compare the SHA-256 of `pkg/rust_fetch_bg.wasm` with the one in the tarball from `npm pack rust-fetch@<version>`. A different toolchain gives different bytes, which is not a sign of tampering. The repository is also scored by the [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/asemqaffaf/rust-fetch).
- **Provenance and integrity:** Every release is built on GitHub Actions with pinned toolchains, signed with npm provenance attestations, and verified after publication. Tarballs are tested in clean environments against size, API, and benchmark regression gates before publishing.

## Package contents and expected capabilities

The npm package maintains a strict zero-dependency footprint: **Dependencies (0)** and **Dev Dependencies (0)**. There are no runtime npm dependencies, no development dependencies shipped in the published tarball, and no install scripts (`preinstall`, `install`, or `postinstall`). It includes only the pre-compiled WebAssembly module, JavaScript bindings, TypeScript definitions, and documentation; installation does not compile Rust or download a remote native binary. Releases are built and tested in GitHub Actions, published with npm provenance, and checked after publication for a valid registry signature and provenance attestation.

Network access is part of the client's purpose: HTTP requests, redirects, Server-Sent Events, and WebSocket connections use destinations supplied by the application. In browsers, `init()` also fetches the bundled `.wasm` asset unless the application supplies bytes or a compiled module. The package does not send usage telemetry or check for updates.

The Node.js entry reads its bundled `.wasm` file on import. It can load an optional local native addon, including a path configured with `RUST_FETCH_NATIVE`, and that addon can read a certificate file configured with `NODE_EXTRA_CA_CERTS`. The transport also reads proxy and TLS environment settings (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_TLS_REJECT_UNAUTHORIZED`). Importing the Node.js entry does not make an outbound network request.

Scanners may flag these capabilities for review. A network-access alert is expected for this HTTP client; it does not by itself indicate an undisclosed destination or a vulnerability. Review the published files and the [security guide](https://asemqaffaf.github.io/rust-fetch/security) for URL restrictions, credential handling, private-network blocking, and resource limits. The safety limits that are opt-in must be configured for the application's trust boundaries.
