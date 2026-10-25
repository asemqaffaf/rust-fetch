# Client options

The examples in this section use a client like this one:

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
