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
| `retries` | no retries | A count or `RetryOptions`; see [Retries](/guide/timeouts-and-retries#retries) |
| `idempotencyKey`, `idempotencyHeader` | off, `Idempotency-Key` | Key generation/header defaults; requires server deduplication. See [Idempotency keys](/guide/timeouts-and-retries#idempotency-keys) |
| `retryBudget` | no budget | `true` or `{ ratio, minPerSecond, windowMs }`: limits retries across the client; see [Retries](/guide/timeouts-and-retries#retries) |
| `redirect`, `maxRedirects` | `'follow'`, `20` | See [Redirects](/guide/requests#redirects) |
| `sensitiveHeaders` | none | Your own credential headers (e.g. `X-Api-Key`), dropped on cross-origin redirects like `Authorization` (Node.js); see [Security](/security#security) |
| `allowInsecureRedirects` | `true` | `false` rejects a redirect from `https:` to `http:` (Node.js); see [Security](/security#security) |
| `allowAbsoluteUrls` | `true` | `false` rejects absolute URLs; see [Absolute URLs](/security#absolute-urls-and-baseurl) |
| `allowPrivateNetwork` | `true` | `false` blocks loopback, private, link-local and metadata addresses (Node.js); see [SSRF](/security#fetching-user-supplied-urls-ssrf) |
| `maxResponseBytes` | no limit | Largest response body, after decompression; see [Size limits](/security#response-size-limits-and-decompression-bombs) |
| `maxConcurrent`, `rateLimit`, `limitsPerOrigin` | off, off, `false` | Limit attempts in flight and their rate, globally or per origin; see [Load limits](/guide/load-limits) |
| `maxPendingRequests` | no limit | Refuse requests beyond this many unfinished ones; see [Load shedding](/security#limiting-pending-requests-load-shedding) |
| `maxLineBytes`, `maxEventBytes` | no limit | Longest NDJSON or SSE line, and largest SSE event; see [Limiting line length](/security#limiting-line-length) |
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
