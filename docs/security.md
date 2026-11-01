# Security

What the client does for you, each behaviour covered by tests:

- **Credentials stay with their origin on redirects.** When a redirect leaves the origin (another host, port or scheme, including `https:` to `http:`), the Node.js transports drop `Authorization`, `Cookie` and `Proxy-Authorization`. This is the class of bug behind CVEs in node-fetch, follow-redirects and undici. Browsers apply their own, equivalent rules.
- **Your own credential headers too, and no downgrades, when you ask.** List headers such as `X-Api-Key` in `sensitiveHeaders` and they're dropped the same way; without it, custom headers follow a redirect to another origin. With `allowInsecureRedirects: false`, a redirect from `https:` to `http:` rejects with a `NetworkError` instead of sending the request (and a 307/308 body) unencrypted. Both are client or per-request options, on both Node.js transports. In the Rust client, which can't drop a header mid-redirect, a request carrying a listed header refuses redirects to another origin instead. Browsers follow redirects themselves, so these options don't apply there.
- **No header injection.** A header name or value containing CR or LF rejects with an `InvalidInputError` before anything is sent.
- **Only `http:` and `https:`.** Request URLs, `baseUrl`, and redirect targets with any other scheme (`file:`, `data:`, …) are rejected.
- **Paths stay under `baseUrl`.** Relative paths, including tricks like `//other.host/x` or `/\other.host`, resolve under the base URL (the class of axios CVE-2024-39338).
- **Proxy credentials go only to the proxy.** They're sent as `Proxy-Authorization` to the proxy, never to the origin.
- **No runtime dependencies.** The npm package has none, and every release is published from CI with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). Rust dependencies are audited in CI (`cargo-deny`: advisories, licenses, sources). JavaScript lockfiles for development, docs, and examples are audited with `npm audit`, including development dependencies.

## Supply chain review

The npm package includes its WebAssembly module and JavaScript bindings, has no install scripts, and does not download or compile a native addon during installation. The optional native transport is built separately. The contribution guide, code of conduct, and security policy are included in the package.

Network access is expected: requests, redirects, Server-Sent Events, and WebSockets connect to destinations supplied by the application. Browser initialization also fetches the `.wasm` asset unless given bytes or a compiled module. Importing the Node.js entry reads the bundled `.wasm` locally and does not make an outbound request. There is no usage telemetry or update check. The [security policy](https://github.com/asemqaffaf/rust-fetch/blob/main/SECURITY.md#package-contents-and-expected-capabilities) describes file access, optional addon loading, and environment settings too.

Package ratings combine different signals. A capability alert such as network access needs review in the context of an HTTP client, while popularity and community ratings depend on adoption and participation. A rating or an absence of known vulnerabilities does not replace a review of the application's configuration and trust boundaries.

## Security compared with `fetch()` and axios

The same attacks against each client, with the protections it offers turned on (`npm run security:compare`; Node.js 22.13, axios 1.20). Each rust-fetch row is also a regression test in CI (`wasm-module/js/test/security.test.mjs`), named after the advisories it covers.

| Attack | rust-fetch | Node's `fetch()` | axios |
| --- | --- | --- | --- |
| Credentials on a cross-origin redirect (node-fetch CVE-2022-0235, follow-redirects CVE-2022-0536 and CVE-2024-28849, undici CVE-2023-45143 and CVE-2024-24758) | dropped | dropped | dropped |
| CR/LF in a header (undici CVE-2022-31150, CVE-2022-35948) | rejected before sending | rejected | stripped silently |
| Path tricks with a base URL (axios CVE-2024-39338) | stay on the base host | no base URL | stay on the base host |
| Absolute URL with a base URL (axios CVE-2025-27152) | blocked with `allowAbsoluteUrls: false` | no base URL | blocked with `allowAbsoluteUrls: false` |
| Redirect to `file:` | refused | refused | refused |
| 256 MB gzip bomb | rejected with `maxResponseBytes`, +3 MB of memory | **no limit available**: accepted, +853 MB | rejected with `maxContentLength`, +2 MB |
| Request to the cloud metadata endpoint `169.254.169.254` (SSRF) | **blocked** with `allowPrivateNetwork: false` | no built-in check | no built-in check |
| Runtime dependencies | none | built in | 4 |

Only rust-fetch blocks SSRF before connecting, and rejects header injection instead of altering the header. Like axios, and unlike `fetch()`, it can bound a response's size. Every protection that isn't on by default (absolute URLs, size, private networks) is one option away.

## Absolute URLs and `baseUrl`

By default, as in axios, an absolute URL passed to a client with a `baseUrl` replaces the base URL, **and receives the client's headers**, such as `Authorization`. If any part of a request URL comes from user input, an attacker can send it to their own server along with your credentials (the class of axios CVE-2025-27152). Turn it off:

```js
const api = new WasmClient({
  baseUrl: 'https://api.example.com/v1',
  headers: { authorization: `Bearer ${token}` },
  allowAbsoluteUrls: false,
});
await api.get(`/users/${userInput}`);   // stays on api.example.com
await api.get('https://evil.example/'); // rejects with InvalidInputError (parameter: 'url'); nothing is sent
await api.get('https://partner.example/data', { allowAbsoluteUrls: true }); // per request, deliberately
```

`allowAbsoluteUrls` applies to requests, `client.events()` and `client.websocket()`, and can be set per request. In Rust, it's `ClientBuilder::allow_absolute_urls(false)`.

## Response size limits and decompression bombs

A server, or anyone who controls a URL you fetch, can send an endless body, or a few kilobytes of gzip that decompress to gigabytes, and exhaust your process's memory. `fetch()` has no way to limit either. Set `maxResponseBytes`:

```js
const client = new WasmClient({ maxResponseBytes: 10 * 1024 * 1024 });        // 10 MB, for every request
await client.get('/export', { maxResponseBytes: 500 * 1024 * 1024 });         // per request
await client.get('/trusted', { maxResponseBytes: null });                     // no limit for this one
// → NetworkError "Response body larger than maxResponseBytes (10485760 bytes)", error.maxResponseBytes === 10485760
```

The limit is on the decompressed body, and it's enforced on every transport (node:http, native, browser `fetch()`), without reading more than needed:

- A `Content-Length` over the limit fails before the body is read. For a compressed body, the limit applies to its decompressed size.
- Without a `Content-Length`, the body is counted as it arrives, and reading stops at the limit.
- Decompression is bounded too: zlib, brotli and zstd stop one byte past the limit. A 64 MB gzip bomb with a 1 MB limit fails without expanding in memory (tested for gzip, deflate, brotli and zstd).
- Error responses and streamed bodies (`responseType: 'stream' | 'ndjson'`) are limited the same way; a stream errors once it passes the limit. In browsers, a request with `onUploadProgress` and a limit uses `fetch()` instead of `XMLHttpRequest`, which can't stop at a limit.

The default is no limit, as before. For servers that fetch URLs they don't control, set one.

## Limiting pending requests (load shedding)

If requests arrive faster than an upstream answers, they pile up: in Node.js, at most 1,024 are handed to a transport at once and the rest wait in memory, without limit. A caller that can't keep up should refuse work rather than run out of memory. Set `maxPendingRequests`:

```js
const client = new WasmClient({ maxPendingRequests: 500 });
try {
  await client.get('/search');
} catch (error) {
  if (error.maxPendingRequests) return reply503(); // refused at once, nothing was sent
  throw error;
}
// → NetworkError "Too many pending requests (maxPendingRequests is 500)", error.maxPendingRequests === 500
```

- **It limits every unfinished request, not only the waiting ones.** A request counts from the call until it settles: while it's in flight as well as while it waits for a connection, retries and their delays included. So it bounds the client's total work, and with a limit under 1,024 Node.js requests never queue behind the transport at all. A streamed response (`'stream'`, `'ndjson'`) counts until its headers arrive.
- A request beyond the limit rejects at once, before anything is sent (request interceptors have already run), so the rejection costs almost nothing.
- Failures, timeouts and cancellation free the place like successes do.
- The count is per client, and it applies on every transport (node:http, native, browser `fetch()` and `XMLHttpRequest`) and in the Rust crate (`ClientBuilder::max_pending_requests`). `client.events()` and `client.websocket()` aren't counted.

The default is no limit, as before.

**Why it matters under sustained overload.** In Node.js each pending request holds about 7 KB (about 3 KB of JavaScript heap and 3.7 KB of WebAssembly memory; CI keeps the WebAssembly part under a budget). Without a limit, a client offered far more than its upstream can answer keeps them all, and the backlog grows until requests time out: in a test, 50,000 requests per second against a server answering about 15,000, with 30-second timeouts, held up to about 3.5 GB. Before 2.6.0 the same backlog cost about 9 KB per request and brought Node.js to its heap limit, where garbage collection stalled the process for minutes (from 45,000 requests per second with 2.5.2). With `maxPendingRequests: 1000` in the same test, peak memory stayed at about 200 MB, p99 latency at about 100 ms, and the excess was refused at once. Set it on any client that can be offered more than it can deliver; it's off by default so that bulk jobs that queue many requests on purpose keep working.

## Limiting line length

`maxResponseBytes` limits a whole response, but a stream of newline-delimited JSON or Server-Sent Events can run for hours, and an incomplete line is held in memory until its line break arrives. A server that never sends one grows that line without bound. Set `maxLineBytes`:

```js
const client = new WasmClient({ maxLineBytes: 1024 * 1024 });                    // 1 MB per line
const res = await client.get('/watch', { responseType: 'ndjson' });             // or per request; null for none
for await (const event of client.events('/feed', { maxLineBytes: 64 * 1024 })) { /* … */ }
// → NetworkError "Line longer than maxLineBytes (1048576 bytes)", error.maxLineBytes === 1048576
```

- **Bytes, line break excluded.** A line is counted in UTF-8 bytes, without its `\n`, `\r\n` (or, in event streams, `\r`), the same however the network splits it, including a character or a `\r\n` split between chunks. A line exactly at the limit is accepted.
- **Checked before it's buffered.** No more than the limit is ever held for one line, whether it arrives as one huge chunk or as an endless trickle.
- **What happens:** the lines (or events) before the long one are delivered, then the stream errors with a `NetworkError` whose `maxLineBytes` is the limit, and the connection is closed. An event stream ends and isn't reconnected, since it would get the same line again.
- **Event streams:** every line counts, comments included. Each `data:` line is checked on its own, so `maxLineBytes` doesn't limit an event's total: an event made of many `data:` lines is assembled in memory until the blank line that ends it, with `onEvent` as well as `for await` (`onEvent` changes how events are delivered, not how they're assembled). Set **`maxEventBytes`** for that: an event whose data (its `data:` lines joined with `\n`) would pass it is refused before it's buffered, the events before it are delivered, and the stream errors with a `NetworkError` whose `maxEventBytes` is the limit, without reconnecting. Client option, or per stream with `events(url, { maxEventBytes })` (`null` for none). A client's `maxResponseBytes` caps the whole stream instead, which also ends a long-lived one.

The default is no limit, as before.

## Fetching user-supplied URLs (SSRF)

A server that fetches URLs its users give it (webhooks, link previews, image proxies, importers) can be pointed at its own network: `http://169.254.169.254/` (cloud credentials), `http://localhost:6379/`, an admin panel on `10.0.0.5`. Checking the URL string isn't enough: a public-looking name can resolve to a private address, and a redirect can point anywhere. In Node.js, set `allowPrivateNetwork: false`:

```js
const fetcher = new WasmClient({ allowPrivateNetwork: false, maxResponseBytes: 5 * 1024 * 1024, timeoutMs: 10_000 });
await fetcher.get(userUrl); // NetworkError "Blocked: … resolves to 10.0.0.5, a private or reserved address" for internal targets
```

- **Every address is checked when connecting:** the host's DNS answers (all of them), or the IP address itself. So DNS rebinding can't get past it, and each redirect is checked again.
- **Blocked ranges:**
  - IPv4: loopback, RFC 1918 private, link-local (including the 169.254.169.254 metadata endpoint), carrier-grade NAT, "this network", multicast, reserved and documentation ranges
  - IPv6: loopback, unspecified, unique-local, link-local, site-local, multicast and documentation ranges, the deprecated IPv4-compatible `::a.b.c.d` addresses, and local-use NAT64 (`64:ff9b:1::/48`), plus the forms that carry an IPv4 address: IPv4-mapped (`::ffff:10.0.0.1`), IPv4-translated (`::ffff:0:10.0.0.1`), NAT64 (`64:ff9b::…`), 6to4 (`2002:…`) and Teredo (`2001:0:…`) addresses are blocked when the IPv4 address inside them is
  - Other spellings: the URL parser turns hexadecimal, octal, decimal and short IPv4 forms (`0x7f.1`, `2130706433`, `127.1`) into the dotted address before the check, and host names are checked by what they resolve to, so `localhost.` and `foo.localhost` are covered
- **Separate connection pool:** checked requests never reuse a connection another client made to a private address.
- **Proxies:** a proxy resolves host names itself, so this client can't see which address it connects to. With `allowPrivateNetwork: false` and a proxy for the target, an IP-address target is checked as usual and a host name is refused, before anything is sent, with a `NetworkError` ("allowPrivateNetwork: false can't check … through a proxy"). The same goes for a redirect to a name. Use an IP address, bypass the proxy for that host (`NO_PROXY` with `proxy: 'env'`), or enforce the rule in the proxy. Before 2.7.0, names went through the proxy unchecked.
- **WebSockets too:** `client.websocket()` (Node's built-in WebSocket, which connects through undici rather than `node:http`) gets its own checked connection pool. An IP address that is private or reserved throws a `NetworkError` from `websocket()` before anything connects; a host name is checked on every connection, reconnections included, and a blocked one fails the attempt with the same "Blocked: …" message. Set it per connection with `websocket(url, { allowPrivateNetwork })`. It can't be combined with your own `dispatcher` (whose connections it couldn't check), and while another undici global dispatcher is installed (for example a `ProxyAgent` from `setGlobalDispatcher`) `websocket()` throws an `InvalidInputError` instead of connecting unchecked.
- **Not covered:** in browsers this option does nothing; they enforce their own private-network rules.
- **Combine it with limits:** use `maxResponseBytes`, `timeoutMs` and `allowAbsoluteUrls` (above) when fetching anything untrusted.

## Hardened configurations

The protections above are off by default, so upgrading doesn't change behaviour. These three configurations turn them on for common cases. Each is checked by a test that reads it from this page ([`hardened.test.mjs`](https://github.com/asemqaffaf/rust-fetch/blob/main/wasm-module/js/test/hardened.test.mjs)) and exercises every protection its comments claim, so the documentation can't drift from what the client does.

**A fixed API with credentials.** Paths come from your code or your users; the token must never reach another host.

<!-- hardened:api -->
```js
const api = new WasmClient({
  baseUrl: 'https://api.example.com/v1',
  headers: { authorization: `Bearer ${token}` },
  allowAbsoluteUrls: false,           // a path can't replace the host, so the token stays with it
  redirect: 'error',                  // no redirects at all (or follow them with sensitiveHeaders and allowInsecureRedirects: false)
  timeoutMs: 10_000,                  // per attempt, including the body
  retries: 2,                         // GET, HEAD, PUT, DELETE…; POST and PATCH aren't retried
  retryBudget: true,                  // no retry storms when the API struggles
  maxPendingRequests: 256,            // shed load instead of queuing without bound
  maxResponseBytes: 10 * 1024 * 1024, // 10 MB, after decompression
});
```

**Fetching URLs from users** (webhooks, link previews, importers) on a Node.js server. No credentials, and nothing internal reachable.

<!-- hardened:fetcher -->
```js
const fetcher = new WasmClient({
  allowPrivateNetwork: false,         // no loopback, private, link-local or metadata addresses, checked on every redirect
  maxRedirects: 3,
  timeoutMs: 5_000,
  maxResponseBytes: 5 * 1024 * 1024,  // 5 MB, after decompression
  maxPendingRequests: 100,
});
```

Not covered by this client, so handle them elsewhere: targets behind a proxy, which resolves names itself (this client refuses host names there, so the proxy needs the same rule for the IP addresses it is given); and in browsers, where `allowPrivateNetwork` does nothing. Add an allowlist of hosts or schemes in your code if you can, and egress rules in your network.

**Streaming APIs** (LLMs over Server-Sent Events or NDJSON). Long-lived responses, so the per-attempt timeout isn't enough.

<!-- hardened:streaming -->
```js
const llm = new WasmClient({
  baseUrl: 'https://llm.example.com',
  headers: { authorization: `Bearer ${token}` },
  allowAbsoluteUrls: false,
  redirect: 'error',
  timeoutMs: 30_000,                  // until the response headers arrive
  maxLineBytes: 1024 * 1024,          // 1 MB per NDJSON line or SSE line
  maxEventBytes: 4 * 1024 * 1024,     // 4 MB per SSE event, however many data: lines it has
  maxPendingRequests: 64,             // requests on this client; events() streams aren't counted
});
const stream = llm.events('/v1/chat/completions', {
  method: 'POST',
  body: { model, messages, stream: true },
  messageType: 'json',
  signal: AbortSignal.timeout(5 * 60_000), // the whole stream, not just its headers
});
```

`for await` over the stream holds the server back when your loop is slow. Left out on purpose: `maxResponseBytes`, which would also end a long stream.

## Prototype pollution

If something else in the process pollutes `Object.prototype`, the client must not read the pollution as settings. Before 2.7.0 (and the patch releases listed in the security advisory), it did in several places. On the Node.js transports an inherited `proxy` (2.4.0 and later) sent requests, their `Authorization` headers and their bodies to the attacker's server; an inherited undici `dispatcher` did the same for `websocket()` connections (2.2.0 and later); an inherited `ca` made the attacker's certificate authority trusted for HTTPS (every 2.x release); an inherited `body`, `signal`, `auth` or `path` altered or aborted requests; inherited `blockPrivateNetwork`, `maxResponseBytes` and timeout fields made requests fail (2.5.0 and later); and, in the unreleased streaming-upload code, inherited upload state threw outside a request and ended the process. In 2.0.0 and earlier (and 1.x and 0.x), Node.js requests went through Node's built-in `fetch()`, whose option handling in undici reads `method`, `headers`, `body`, `signal` and `dispatcher` from the prototype chain, so every request was exposed; the `node:http` transport of 2.1.0 and later doesn't use `fetch()`. In browsers, the requests this client makes were not affected (checked in Chromium, Firefox and WebKit).

Now, on both Node.js transports:

- **Internal objects have no prototype.** The request the Wasm core hands to the transport, the per-request state, upload records and sessions, the native addon's request and response, the diagnostics state, `RequestInit` and WebSocket init objects: none inherits from `Object.prototype`, and values read back from them are read as their own properties.
- **Options on plain objects ignore the prototype chain**, at the top level and in nested option objects (`retries`, `retryBudget`, `circuitBreaker`, `rateLimit`, WebSocket and SSE options). An options object with its own prototype (shared defaults, a class instance) still inherits, deliberately.
- **Options Node.js reads by inheritance are set explicitly.** `http.request`, `net.connect` and `tls.connect` copy their options into plain objects and read names such as `socketPath`, `auth`, `lookup`, `ca` and `servername` from them. The transport passes every such name as an own property, and the URL as options rather than as a `URL` object (Node only recognises one while it has no inherited `auth` or `path`).
- **Protections stay in force:** an unknown certificate is still refused, `allowPrivateNetwork: false` still blocks, `maxResponseBytes` still applies, and explicit options still take effect, including `false`, `0` and `null` where those mean something.

[`prototype-pollution.test.mjs`](https://github.com/asemqaffaf/rust-fetch/blob/main/wasm-module/js/test/prototype-pollution.test.mjs) pollutes every one of those names with hostile values, in child processes, against both transports, and checks that nothing changes: no request reaches an attacker's proxy or dispatcher, no certificate is trusted, and nothing throws outside a request.

**What the client can't fix.** Node.js's own `http`, `net` and stream modules read some names from the prototype chain themselves: an event named `timeout` (`socket.on('timeout')` fails with "existing.push is not a function"), and the `signal` stream option (every new socket and every incoming response then throws). With those names polluted, any Node.js HTTP client fails, this one included on the `node:http` transport; the native transport is unaffected except for streamed responses and progress callbacks, which use `node:http`. Fix the pollution at its source. Freezing the prototype (`Object.freeze(Object.prototype)`, or `node --disable-proto=delete --frozen-intrinsics`) prevents it.

## Transport isolation (2.7.0)

Each native Node adapter module owns its connection pool, TLS configuration and request cancellation scope. Worker environments cannot change one another's verification policy or cancel requests with the same numeric ID. Leaving a worker closes its pending native requests, including calls with `timeoutMs: 0`. Within a scope, an active ID cannot be overwritten and a cancelled request's late completion cannot remove its replacement.

Each Wasm instance is bound to its own Node adapter and WebSocket guard during entry-point initialization. Loading another package copy before constructing a client cannot change the first copy's transport or native TLS policy. The global discovery hooks do not select an instance's adapter.

Node response processing uses actual raw header pairs. Inherited `Object.prototype` properties cannot supply framing, decompression, a MIME type or a redirect location; response header objects keep their usual plain-object shape. A response header named `__proto__` is preserved as data.

The Rust client's alternative reqwest pools for per-request connect/redirect settings are capped at 32. Eviction drops only the cached handle; active requests keep their own clones.

Secret scanning and Dependabot security updates are enabled for the GitHub repository. Dependency advisory checks and release provenance remain enforced in CI.

## 2.7.0 audit

- Native TLS policy, pending IDs and cancellation are scoped to an adapter; each Wasm instance explicitly binds its HTTP transport and WebSocket guard. A later package import or replacement of global discovery hooks cannot change that binding.
- Native idle-origin caches retain at most 256 idle entries during admission/cleanup, while active origin handles keep their semaphore and pool. The Rust client's alternative transport cache remains capped at 32.
- Optional logs and lifecycle hooks redact URL user info, query strings, credential headers and sensitiveHeaders, and never export bodies/error messages. Trace context requires an explicit destination allowlist and is stripped on cross-origin redirects. Browser automatic tracing refuses redirects.
- Scheduled parser and JavaScript/Wasm boundary fuzzing runs offline against the actual validation paths. Crashes retain reproducers; a separate scheduled-report job can open an issue without giving pull-request test jobs write permissions.
- Fault-injection rows run on every adapter in the conformance matrix. Header-buffer limits remain controlled by each runtime: macOS WebKit accepts the tested 1 MiB header, while Linux WebKit rejects it as a `NetworkError`. The matrix records both platform outcomes.
- Secret scanning and Dependabot security updates were verified enabled through GitHub's API on 2026-10-29.

See [observability](./guide/observability.md) for redaction boundaries and [reliability](./reliability.md) for the fault methodology and gap decisions.
