# Security

What the client does for you, each behaviour covered by tests:

- **Credentials stay with their origin on redirects.** When a redirect leaves the origin (another host, port or scheme, including `https:` to `http:`), the Node.js transports drop `Authorization`, `Cookie` and `Proxy-Authorization`. This is the class of bug behind CVEs in node-fetch, follow-redirects and undici. Browsers apply their own, equivalent rules.
- **Your own credential headers too, and no downgrades, when you ask.** List headers such as `X-Api-Key` in `sensitiveHeaders` and they're dropped the same way; without it, custom headers follow a redirect to another origin. With `allowInsecureRedirects: false`, a redirect from `https:` to `http:` rejects with a `NetworkError` instead of sending the request (and a 307/308 body) unencrypted. Both are client or per-request options, on both Node.js transports. In the Rust client, which can't drop a header mid-redirect, a request carrying a listed header refuses redirects to another origin instead. Browsers follow redirects themselves, so these options don't apply there.
- **No header injection.** A header name or value containing CR or LF rejects with an `InvalidInputError` before anything is sent.
- **Only `http:` and `https:`.** Request URLs, `baseUrl`, and redirect targets with any other scheme (`file:`, `data:`, …) are rejected.
- **Paths stay under `baseUrl`.** Relative paths, including tricks like `//other.host/x` or `/\other.host`, resolve under the base URL (the class of axios CVE-2024-39338).
- **Proxy credentials go only to the proxy.** They're sent as `Proxy-Authorization` to the proxy, never to the origin.
- **No runtime dependencies.** The npm package has none, and every release is published from CI with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). Rust dependencies are audited in CI (`cargo-deny`: advisories, licenses, sources).

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
  - IPv6: loopback, unspecified, unique-local, link-local and multicast, plus IPv4-mapped (`::ffff:10.0.0.1`) and NAT64 (`64:ff9b::…`) forms of the IPv4 ranges
- **Separate connection pool:** checked requests never reuse a connection another client made to a private address.
- **Proxies:** through a proxy, only IP-address targets are checked, since the proxy resolves names. Apply the same rule in the proxy's own configuration.
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

Not covered by this client, so handle them elsewhere: targets behind a proxy, where only IP addresses are checked (the proxy needs the same rule); and in browsers, where `allowPrivateNetwork` does nothing. Add an allowlist of hosts or schemes in your code if you can, and egress rules in your network.

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
  maxPendingRequests: 64,
});
const stream = llm.events('/v1/chat/completions', {
  method: 'POST',
  body: { model, messages, stream: true },
  messageType: 'json',
  signal: AbortSignal.timeout(5 * 60_000), // the whole stream, not just its headers
});
```

`for await` over the stream holds the server back when your loop is slow. Left out on purpose: `maxResponseBytes`, which would also end a long stream.
