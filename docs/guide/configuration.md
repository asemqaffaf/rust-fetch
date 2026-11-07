# Client options

The examples in these docs use a client like this one:

```js
import { WasmClient } from 'rust-fetch';

const client = new WasmClient({ baseUrl: 'https://api.example.com/v1' });
```

```ts
const client = new WasmClient({
  baseUrl: 'https://api.example.com/v1', // relative request URLs are appended to this
  headers: { Authorization: 'Bearer …' }, // sent with every request
  timeoutMs: 10_000,                      // per attempt; 0 disables. Default: 30000
  retries: 3,                             // or a RetryOptions object, see Retries
  redirect: 'follow',                     // or 'manual' / 'error', see Redirects. Default: 'follow'
  maxRedirects: 20,                       // Node.js; browsers apply their own limit. Default: 20
  proxy: 'env',                           // Node.js: HTTPS_PROXY / HTTP_PROXY / NO_PROXY, or a proxy URL; see Proxies
  allowAbsoluteUrls: false,               // reject absolute URLs instead of letting them replace baseUrl; see Security. Default: true
});
```

Every client option:

| Option | Default | Description |
| --- | --- | --- |
| `baseUrl` | none | Relative request URLs resolve under it; see [Making requests](/guide/requests#making-requests) |
| `headers` | none | Sent with every request; a request header with the same name wins |
| `timeoutMs` | `30000` | Per attempt, until the last byte of the body; `0` disables it. See [Timeouts](/guide/timeouts-and-retries#timeouts) |
| `connectTimeoutMs`, `responseTimeoutMs`, `idleTimeoutMs`, `deadlineMs` | off | Optional phase timers and a deadline including queues, retries and body lifetime. `0` disables each independently. See [Timeouts](/guide/timeouts-and-retries#timeouts) |
| `retries` | no retries | A count or `RetryOptions`; see [Retries](/guide/timeouts-and-retries#retries) |
| `idempotencyKey`, `idempotencyHeader` | off, `Idempotency-Key` | Key generation/header defaults; requires server deduplication. See [Idempotency keys](/guide/timeouts-and-retries#idempotency-keys) |
| `retryBudget` | no budget | `true` or `{ ratio, minPerSecond, windowMs }`: limits retries across the client; see [Retries](/guide/timeouts-and-retries#retries) |
| `redirect`, `maxRedirects` | `'follow'`, `20` | See [Redirects](/guide/requests#redirects) |
| `sensitiveHeaders` | none | Your own credential headers (e.g. `X-Api-Key`), dropped on cross-origin redirects like `Authorization` (Node.js); see [Security](/security#security) |
| `allowInsecureRedirects` | `true` | `false` rejects a redirect from `https:` to `http:` (Node.js); see [Security](/security#security) |
| `allowAbsoluteUrls` | `true` | `false` rejects absolute URLs; see [Absolute URLs](/security#absolute-urls-and-baseurl) |
| `allowPrivateNetwork` | `true` | `false` blocks loopback, private, link-local and metadata addresses (Node.js); see [SSRF](/security#fetching-user-supplied-urls-ssrf) |
| `maxResponseBytes` | no limit | Largest response body, after decompression; see [Size limits](/security#response-size-limits-and-decompression-bombs) |
| `circuitBreaker`, `onCircuitChange` | off, none | Fail fast per origin after consecutive availability failures; see [Circuit breakers](/guide/circuit-breakers) |
| `maxConcurrent`, `rateLimit`, `limitsPerOrigin` | off, off, `false` | Limit attempts in flight and their rate, globally or per origin; see [Load limits](/guide/load-limits) |
| `maxPendingRequests` | no limit | Refuse requests beyond this many unfinished ones; see [Load shedding](/security#limiting-pending-requests-load-shedding) |
| `maxLineBytes`, `maxEventBytes` | no limit | Longest NDJSON or SSE line, and largest SSE event; see [Limiting line length](/security#limiting-line-length) |
| `timings`, `metrics` | `false` | Request/attempt timings and bounded client statistics; see [Observability](/guide/observability) |
| `onRequestStart`, `onRequestEnd` | none | Isolated logical-request lifecycle observers, with sanitized destinations |
| `debug` | `false`, or Node's `DEBUG=rust-fetch` | Redacted structured diagnostics; `true` uses `console.debug`, or supply a callback |
| `redactUrl` | none | Synchronous URL redactor for errors and sanitized diagnostic URLs |
| `propagateTrace`, `traceOrigins`, `traceContext` | `false`, none, none | Automatic W3C tracing requires an exact HTTP origin allowlist and a synchronous context provider; see [Trace context](/guide/observability#w3c-trace-context) |
| `proxy` | none | Node.js; see [Proxies](#proxies) |
| `credentials`, `mode`, `cache`, `keepalive`, `priority`, `referrer`, `referrerPolicy`, `integrity` | as in `fetch()` | Browsers; see [Browser request options](/guide/requests#browser-request-options) |

Most of them can also be set per request; see [Request options](/guide/requests#request-options).

## Proxies

In Node.js, requests can go through an HTTP or HTTPS proxy: HTTPS requests through a `CONNECT` tunnel, so the proxy never sees their contents, and plain HTTP requests as absolute-URL requests.

```js
new WasmClient({ proxy: 'env' });                              // HTTPS_PROXY, HTTP_PROXY and NO_PROXY (or lower case)
new WasmClient({ proxy: 'http://user:pass@proxy.internal:3128' }); // every request; credentials as Proxy-Authorization
```

- `'env'` reads the variables on each request: `HTTPS_PROXY` for `https:` URLs, `HTTP_PROXY` for `http:` ones, and skips hosts in `NO_PROXY`. A `NO_PROXY` entry is `*`, a host name (which also covers its subdomains; a leading `.` or `*.` is optional) or an IP address (matched exactly), each with an optional `:port`.
- `NODE_USE_ENV_PROXY=1`, which Node.js uses for its own `fetch()`, turns on `'env'` for clients without a `proxy` option.
- Proxied requests use the `node:http` transport, with a pool of connections per proxy. This includes streamed responses (`'stream'`, `'ndjson'`) and `events()`.
- Browsers use the system's proxy settings and ignore this option.

Invalid options throw an `InvalidInputError` right away, from the constructor.

## Authentication

`auth` adds credentials to every request to the client's own origin, and can refresh an expired bearer token.

```js
const client = new WasmClient({
  baseUrl: 'https://api.example.com',
  auth: {
    bearer: () => tokens.access, // a string, or a function (sync or async) called for each request
    refresh: async () => { tokens = await renew(tokens.refresh); }, // optional
  },
});

new WasmClient({ baseUrl, auth: { basic: { username, password } } }); // Basic instead
```

- **Origins.** Credentials go only to the origin of `baseUrl` and the origins in `auth.origins` (for example `['https://uploads.example.com']`). A request to any other origin, including an absolute URL, is sent without them. A client needs one of the two, or the constructor throws an `InvalidInputError`.
- **Your header wins.** A request that sets its own `Authorization` header keeps it. A `bearer` function that returns nothing sends no header.
- **Refresh.** When a request gets `401` and `refresh` is set, `refresh` runs once for all requests failing at the same time. Each of them is then replayed once. A second `401` rejects with the `HttpError`. If `refresh` rejects, the requests reject with their `HttpError` and the failure as `cause`, and the next `401` tries again. Requests with a stream body (`ReadableStream`) are not replayed. A replay is a new call with the same arguments: an `idempotencyKey` you passed as a string is sent again; one generated with `true` is generated again.
- **Where it applies.** HTTP requests and `events()`. WebSocket handshakes do not carry it (browsers cannot set headers on them).
- It is built on a request interceptor that `clearInterceptors()` keeps in place. A client from `extend()` keeps `auth`; `extend({ auth })` replaces it, and each client refreshes on its own.

## Derived clients

`client.extend(overrides)` returns a new client with this one's options and interceptors, and `overrides` on top. Use it for one client per API version, or one with an extra header.

```js
const api = new WasmClient({ baseUrl: 'https://api.example.com', timeoutMs: 10_000, retries: 3 });
const admin = api.extend({ headers: { authorization: `Bearer ${adminToken}` } });
const v2 = api.extend({ baseUrl: 'https://api.example.com/v2' });
```

- `headers` are merged by name (case-insensitive); the override wins. Every other option is replaced as a whole, so `extend({ retries: 0 })` turns retries off and `extend({ retries: { maxRetries: 1 } })` does not inherit the parent's `initialDelayMs`. An override of `undefined` keeps the parent's value.
- The new client starts with the parent's interceptors, in order. Interceptors added or ejected afterwards, on either client, do not affect the other.
- Connection pooling is by the transport, so a derived client opens no connections of its own beyond what its requests need.
- State is not shared: a derived client has its own circuit breaker, rate limit, concurrency limit, retry budget and metrics. Create the limits you want shared on one client and send those requests through it.
- Callbacks and objects in the options (for example `onCircuitChange`) are passed on by reference, not copied.
