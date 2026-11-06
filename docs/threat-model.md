# Threat model

What rust-fetch defends against, what it leaves to you, and where each protection is checked. This is the single place that states it; [the security guide](/security) has the configuration, and its [claims table](/security#claims-and-the-tests-behind-them) has the tests (IDs such as C09 below refer to it).

**Status.** Written by the maintainer's tooling and not yet reviewed by anyone else (#223). Treat it as a draft until it is.

## Assets

| ID | Asset | Where it lives |
| --- | --- | --- |
| A1 | Credentials the application sends: `Authorization`, `Cookie`, API keys, passwords in URLs, request bodies | Request headers, URLs and bodies, in process memory and on the wire |
| A2 | The host's network position: what the machine can reach that an outsider cannot (cloud metadata, internal services, localhost) | The process's sockets |
| A3 | Process memory and availability | The Node.js or browser process |
| A4 | Integrity of the published package and its build | npm, GitHub Actions, the Rust and npm dependency trees |

## Attackers

| ID | Attacker | Controls |
| --- | --- | --- |
| T1 | A malicious or compromised **server** | Everything in a response: status, headers, framing, body, redirects, timing |
| T2 | A **user of the application** (or any source of data the application passes on) | A URL, a header value, a path, an option value |
| T3 | **Code in the same process** that pollutes `Object.prototype` | Inherited properties that options and Node.js internals may read |
| T4 | A malicious **dependency** | Code that runs in the build, or in the user's process |
| T5 | A compromised **CI or release step** | The published artifact |
| T6 | A **network attacker** between client and server | Traffic on the path, certificates they can obtain |

## Adapters and trust boundaries

The Rust core, compiled to Wasm, holds the policy (validation, URL resolution, retries, timeouts, limits, errors). A transport moves bytes. Which transport runs depends on the runtime and the request.

| Adapter | Runs in | Trusts | Enforces itself |
| --- | --- | --- | --- |
| **Wasm core** | Node.js, browsers | Its caller, which can be T2's data; its transport, for framing | Validation and URL rules (C17, C18), retry and timeout policy (C24), response and line limits (C19, C21), load shedding (C22) |
| **node:http** | Node.js | Node's HTTP parser (llhttp) and TLS (OpenSSL) | The SSRF check at connect time (C09, C10, C11, C12), cross-origin credential stripping (C14, C15, C16), refused redirect schemes (C28) |
| **Native addon** | Node.js, when built | hyper for HTTP/1.1, rustls for TLS | The same redirect and limit rules, and a TLS configuration, pool and cancellation scope of its own per adapter (C26: by design, not tested across threads). It is not used when `allowPrivateNetwork: false`, a proxy, streaming bodies or progress callbacks are in play: those requests take node:http even when the addon is loaded |
| **Browser `fetch()`** | Browsers | The browser: CORS, mixed content, TLS, redirect credential rules | Size limits and timeouts in the core. `allowPrivateNetwork` does nothing here, because a browser tab cannot see the address it connects to. The build asks for nothing a strict Content Security Policy blocks, except `'wasm-unsafe-eval'` (C30) |
| **Browser XMLHttpRequest** | Browsers | The same browser rules | Used for upload progress; same limits as `fetch()` |
| **WebSocket** | Node.js (built-in WebSocket, through undici), browsers | The runtime's WebSocket | A checked connection pool with the SSRF rule on every connection and reconnection (C13), bounded send queues (C23) |

## Threats and what answers them

Each threat names a protection with its claim ID, or says why there is none.

| ID | Attacker | Threat | Protection | Residual risk |
| --- | --- | --- | --- | --- |
| TM01 | T1 | A response bigger than memory, including a decompression bomb | `maxResponseBytes` (C19) | Opt-in: the default is no limit. Only gzip has a bomb test |
| TM02 | T1 | An endless line or event in a stream | `maxLineBytes`, `maxEventBytes` (C21) | Defaults apply to streams only |
| TM03 | T1 | A server that never finishes: trickled headers or body, endless `1xx`, endless redirect body | Phase timeouts and `deadlineMs` (C24), redirect body limit (C20) | Opt-in timers; `timeoutMs` has a default |
| TM04 | T1 | Malformed HTTP framing: conflicting lengths, bad chunks, smuggled second response | Rejected by llhttp on node:http, bounded by hyper on the addon. The next request never receives an earlier response | The addon accepts `Content-Length` with `Transfer-Encoding` and reuses the connection (#243) |
| TM05 | T1 | A redirect to another origin to collect credentials | Cross-origin stripping (C14, C15), `allowInsecureRedirects: false` (C16), refused schemes (C28) | `allowInsecureRedirects` defaults to following https to http; browsers follow their own rules |
| TM06 | T1 | A redirect or DNS answer that moves a request to an internal address | The SSRF check on every resolved address and every hop (C09, C10, C13) | Opt-in, Node.js only. In browsers, none |
| TM07 | T2 | A user-supplied URL aimed at the host's network (SSRF) | `allowPrivateNetwork: false` (C09 to C13) | Opt-in. Ranges are tested by sample; a full range test is pending (#237). A proxy that resolves names is refused for names (C12) |
| TM08 | T2 | A user-supplied path that replaces the host of a `baseUrl`, taking the credentials with it | `allowAbsoluteUrls: false` and path rules (C17) | Opt-in for absolute URLs |
| TM09 | T2 | CR or LF in a header name or value | Rejected before sending (C18) | None known |
| TM10 | T3 | Inherited properties redirect requests (`proxy`, `dispatcher`, `ca`) or change options | Prototype-free state and own-property options (C07, C08) | Tested for the options the project knows. A new Node.js option name is a risk until added |
| TM11 | T4 | A malicious npm dependency | No runtime dependencies (C01, C02, C03) | Rust dependencies: audited weekly (C29), `unsafe` inventory pending (#246) |
| TM12 | T4, T5 | A compromised workflow, action or release | Pinned actions, workflow lint, dependency audit, provenance verified after publish (C04, C29) | A maintainer account compromise is outside the checks. Reproducible builds are not yet verified (#232) |
| TM13 | T1, T3 | Secrets copied into logs, traces or errors | Redaction in hooks and logs (C25) | **Not fully answered:** a URL password stays in thrown errors (#238) and `redactUrl` skips `error.cause.url` (#239) |
| TM14 | T6 | Interception of traffic or a forged certificate | TLS verification on by default on both Node transports, with Node's warning when turned off. The per-case TLS table comes with the matrix test (#245) | node:http accepts a name only in the subject, and on Node 20 and 22 a 1024 bit RSA key (#244). Not yet merged: the matrix test |
| TM16 | T4, T5 | The package itself does something unexpected: a request at import, telemetry, an update check | No request at import (C05). No telemetry or update check in the source (C06) | C06 is a source review, not a test. The native addon's sockets are outside C05's check |
| TM15 | T2 | Resource exhaustion by volume: more requests than the upstream can answer | `maxPendingRequests` (C22), WebSocket queue limits (C23) | Opt-in |

C27, the comparison with `fetch()` and axios, is a statement about other clients, not a protection. Every other claim in the claims table is named above, and `claims.test.mjs` fails if a claim ID is in neither this table nor the adapters table. A claim that answers no threat does not belong in the guide.

## Non-goals

These are not defended against, so add your own controls:

- **Egress control.** The library cannot replace a firewall, an egress proxy or an allowlist of destinations. `allowPrivateNetwork: false` removes one class of target; it does not make a URL safe to fetch.
- **The caller's own authorization.** Whether a user may ask for a given URL, and what you do with the response, is the application's decision.
- **A compromised host or runtime.** Someone who controls the process, `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED` or the proxy environment variables controls the client. Trust is process-wide.
- **Browser behaviour.** CORS, mixed content, private-network access and certificate handling belong to the browser. Options that need the connected address do nothing there.
- **Secrets in memory.** Credentials stay in memory as strings for the life of the request. There is no zeroing.
- **Content.** The library does not validate, sanitize or sandbox what a server sends. JSON parsing and rendering are yours.
- **Traffic analysis, timing and covert channels.**
- **A malicious maintainer or registry.** Provenance shows where a package was built, not that its source is benign.

## Known gaps

Open items that weaken a row above: #238, #239 (credentials in errors), #243 (native `Content-Length` with `Transfer-Encoding`), #244 (node:http certificate leniency), #223 (no external review), #232 (reproducible builds). The security guide and this page should change in the same pull request as any of them.
