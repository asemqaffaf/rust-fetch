---
search: false
editLink: false
lastUpdated: false
---

# Client options

::: warning Documentation for 2.6.x
This documents rust-fetch 2.6.x. For the latest version, see the [current documentation](/). The [changelog](https://github.com/asemqaffaf/rust-fetch/blob/main/CHANGELOG.md#270---2026-11-02) lists what 2.7 added.
:::


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
| `baseUrl` | none | Relative request URLs resolve under it; see [Making requests](/v2.6/guide/requests#making-requests) |
| `headers` | none | Sent with every request; a request header with the same name wins |
| `timeoutMs` | `30000` | Per attempt, until the last byte of the body; `0` disables it. See [Timeouts](/v2.6/guide/timeouts-and-retries#timeouts) |
| `retries` | no retries | A count or `RetryOptions`; see [Retries](/v2.6/guide/timeouts-and-retries#retries) |
| `retryBudget` | no budget | `true` or `{ ratio, minPerSecond, windowMs }`: limits retries across the client; see [Retries](/v2.6/guide/timeouts-and-retries#retries) |
| `redirect`, `maxRedirects` | `'follow'`, `20` | See [Redirects](/v2.6/guide/requests#redirects) |
| `sensitiveHeaders` | none | Your own credential headers (e.g. `X-Api-Key`), dropped on cross-origin redirects like `Authorization` (Node.js); see [Security](/v2.6/security#security) |
| `allowInsecureRedirects` | `true` | `false` rejects a redirect from `https:` to `http:` (Node.js); see [Security](/v2.6/security#security) |
| `allowAbsoluteUrls` | `true` | `false` rejects absolute URLs; see [Absolute URLs](/v2.6/security#absolute-urls-and-baseurl) |
| `allowPrivateNetwork` | `true` | `false` blocks loopback, private, link-local and metadata addresses (Node.js); see [SSRF](/v2.6/security#fetching-user-supplied-urls-ssrf) |
| `maxResponseBytes` | no limit | Largest response body, after decompression; see [Size limits](/v2.6/security#response-size-limits-and-decompression-bombs) |
| `maxPendingRequests` | no limit | Refuse requests beyond this many unfinished ones; see [Load shedding](/v2.6/security#limiting-pending-requests-load-shedding) |
| `maxLineBytes`, `maxEventBytes` | no limit | Longest NDJSON or SSE line, and largest SSE event; see [Limiting line length](/v2.6/security#limiting-line-length) |
| `proxy` | none | Node.js; see [Proxies](#proxies) |
| `credentials`, `mode`, `cache`, `keepalive`, `priority`, `referrer`, `referrerPolicy`, `integrity` | as in `fetch()` | Browsers; see [Browser request options](/v2.6/guide/requests#browser-request-options) |

Most of them can also be set per request; see [Request options](/v2.6/guide/requests#request-options).

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
