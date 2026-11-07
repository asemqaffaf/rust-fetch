# Requests and responses

## Making requests

| Method | Use |
| --- | --- |
| `get(url, options?)`, `head(url, options?)`, `delete(url, options?)` | Requests without a body |
| `post(url, init?)`, `put(url, init?)`, `patch(url, init?)` | `init.body` is the body; any other [request option](#request-options) can go next to it |
| `fetch(url, init?)` | `fetch`-style, with `init.method` (default `GET`) |
| `post_json`, `put_json`, `patch_json(url, body, options?)` | Always send `body` as JSON |
| `request(method, url, headers?, body?, options?)` | Fully positional |

```js
await client.post('/users', { body: { name: 'Zoë' } });
await client.get('/search', { params: { q: 'rust wasm', page: 2, tag: ['a', 'b'] } }); // ?q=rust+wasm&page=2&tag=a&tag=b
await client.fetch('/users/1', { method: 'DELETE', headers: { 'X-Reason': 'cleanup' } });
```

Relative URLs need a `baseUrl`. In a browser page without one, they resolve against the page URL. Absolute URLs always win over `baseUrl`. `TRACE` and `CONNECT` are rejected, because browsers' `fetch()` forbids them.

### Request options

| Option | Type | Description |
| --- | --- | --- |
| `headers` | object, `Headers`, `Map` or `[name, value][]` | Override client headers with the same name. Numbers and booleans are converted to strings. |
| `params` | object or `URLSearchParams` | Appended to the query string. Arrays repeat the key; `null`/`undefined` are skipped. |
| `timeoutMs` | number | Overrides the client timeout; `0` disables it |
| `retries` | number or `RetryOptions` | Replaces the client's retry policy; `0` disables retries. Omitted object fields use standard defaults. See [Retries](/guide/timeouts-and-retries#retries) |
| `idempotencyKey`, `idempotencyHeader` | boolean or string, string | Opt in to keyed POST/PATCH retries with server deduplication; see [Idempotency keys](/guide/timeouts-and-retries#idempotency-keys) |
| `responseType` | `'auto'` \| `'json'` \| `'text'` \| `'binary'` \| `'stream'` \| `'ndjson'` | See [Responses](#responses) |
| `signal` | `AbortSignal` | See [Cancellation](/guide/timeouts-and-retries#cancellation) |
| `onDownloadProgress` | `({ loaded, total }) => void` | See [Download progress](/guide/streaming#download-progress) |
| `onUploadProgress` | `({ loaded, total }) => void` | See [Upload progress](/guide/uploads#upload-progress) |
| `redirect` | `'follow'` \| `'manual'` \| `'error'` | Overrides the client's; see [Redirects](#redirects) |
| `maxRedirects` | number | Overrides the client's; see [Redirects](#redirects) |
| `sensitiveHeaders`, `allowInsecureRedirects` | `string[]`, boolean | Override the client's; see [Redirects](#redirects) |
| `allowAbsoluteUrls`, `allowPrivateNetwork` | boolean | Override the client's; see [Security](/security#security) |
| `maxResponseBytes`, `maxLineBytes` | number or `null` | Override the client's limit; `null` for none. See [Size limits](/security#response-size-limits-and-decompression-bombs) |
| `credentials`, `mode`, `cache`, `keepalive`, `priority`, `referrer`, `referrerPolicy`, `integrity` | as in `fetch()` | Browsers; see [Browser request options](#browser-request-options) |

### Browser request options

In browsers and Web Workers, the standard `fetch()` options are passed through: set them on the client for every request, or per request, where each one overrides the client's.

```js
const api = new WasmClient({ baseUrl: 'https://api.example.com', credentials: 'include' }); // send cookies cross-origin
await api.get('/feed', { cache: 'no-store' });                     // bypass the HTTP cache
await api.post('/analytics', { body: event, keepalive: true });    // outlives the page
await api.get('https://cdn.example.com/ping', { mode: 'no-cors' }); // opaque: status 0, no headers or body
```

| Option | Values |
| --- | --- |
| `credentials` | `'same-origin'` (default), `'include'` (cross-origin too; the server must send `Access-Control-Allow-Credentials: true` and its exact origin), `'omit'` |
| `mode` | `'cors'` (default), `'same-origin'`, `'no-cors'` (resolves with an opaque response: `status: 0`, `ok: false`, no headers, `body: null`) |
| `cache` | `'default'`, `'no-store'`, `'reload'`, `'no-cache'`, `'force-cache'`, `'only-if-cached'` |
| `keepalive` | `true` lets the request outlive the page (browsers limit these bodies to 64 KB) |
| `priority` | `'high'`, `'low'`, `'auto'` |
| `referrer`, `referrerPolicy`, `integrity` | As in `fetch()` |

They apply to every request, streamed responses and `client.events()`. With upload progress, which uses `XMLHttpRequest`, `credentials: 'include'` becomes `withCredentials`. For the other options, or `credentials: 'omit'`, the request goes through `fetch()` instead, so upload progress is reported once. Node.js requests don't use these options; invalid values still throw an `InvalidInputError` there.

### Redirects

Redirects (301, 302, 303, 307 and 308) are followed the way `fetch()` follows them: a 303, or a 301 or 302 after `POST`, becomes a `GET` without a body, and `res.url` is the final URL. In Node.js, `Authorization`, `Cookie` and `Proxy-Authorization` headers are dropped when a redirect leaves the origin, and so are the headers you list in `sensitiveHeaders`; `allowInsecureRedirects: false` refuses a redirect from `https:` to `http:` ([Security](/security#security)). Browsers apply their own rules.

| `redirect` | What happens |
| --- | --- |
| `'follow'` (default) | Follow up to `maxRedirects` redirects (default 20); one more rejects with a `NetworkError` |
| `'manual'` | Resolve with the redirect response itself, with `ok: false` and its `Location` header |
| `'error'` | Reject with a `NetworkError` on any redirect (the same as `maxRedirects: 0`) |

```js
const res = await client.get('/login', { redirect: 'manual' });
if (!res.ok) console.log(res.status, res.headers.location); // 302 '/sso?…'
```

In browsers, `fetch()` hides redirects from scripts: with `'manual'` the response has `status: 0` and no headers, and the browser's own limit (20) applies instead of `maxRedirects`. With upload progress in browsers, they send the request with `fetch()` instead of `XMLHttpRequest` (which always follows redirects), so upload progress is reported once.

## Request bodies

The body's type decides how it's sent. A `Content-Type` header you set yourself is always kept, except for `FormData`, which needs its own boundary.

| Body | Sent as | Default `Content-Type` |
| --- | --- | --- |
| `string` | as-is | `text/plain` |
| `Uint8Array`, `ArrayBuffer`, `DataView`, `Buffer` | bytes | `application/octet-stream` |
| `Blob` / `File` | bytes | the blob's `type` |
| `FormData` | `multipart/form-data`, including files | `multipart/form-data; boundary=…` |
| `URLSearchParams` | form-encoded | `application/x-www-form-urlencoded;charset=UTF-8` |
| `ReadableStream`, async iterable, Node `Readable`, or a source factory (2.7.0) | streamed with backpressure | `application/octet-stream` |
| anything else (objects, arrays, numbers, booleans) | `JSON.stringify` | `application/json` |

`null` and `undefined` mean no body. The `*_json` methods are the exception: they always send JSON, so `post_json(url, null)` sends `null`. Streaming bodies and factories are available since 2.7.0; see [Streaming request bodies](/guide/uploads#streaming-request-bodies-270) for replay and browser restrictions.

## Responses

Successful (2xx) requests, and redirects with `redirect: 'manual'`, resolve to:

```ts
interface HttpResponse<T = any> {
  status: number;          // 200
  statusText: string;      // "OK"
  ok: boolean;             // true; false only for a redirect with redirect: 'manual'. Other non-2xx responses reject with an HttpError
  url: string;             // final URL after redirects
  headers: Record<string, string>; // lower-cased names; repeated headers joined with ", "
  body: T;
}
```

With the default `responseType: 'auto'`, `body` is:
- **parsed JSON** for `application/json` and `application/*+json` (e.g. `problem+json`), falling back to text if it isn't valid JSON
- **a string** for `text/*`, XML, JavaScript and form-encoded responses
- **a `Uint8Array`** for anything else
- **`null`** when the body is empty (e.g. `204` or `HEAD`)

Force a type with `responseType: 'json'` (fails with a `ParseError` if the body isn't JSON), `'text'`, `'binary'`, `'stream'` or `'ndjson'` (see [Streaming](/guide/streaming#streaming)). JSON is parsed by the JS engine's `JSON.parse`, exactly like `Response.json()`.

## Pagination

`client.paginate(url, options)` is an async iterator over the pages of a paginated API, or over its items when you give `items`. Each page is a normal `GET`, with the client's retries, timeouts and interceptors.

```js
// Link headers (GitHub-style): the default
for await (const repo of client.paginate('/orgs/acme/repos', { items: (response) => response.body })) {
  console.log(repo.name);
}

// A cursor in the body
for await (const page of client.paginate('/events', {
  params: { limit: 100 },
  next: (response) => response.body.nextCursor && { params: { cursor: response.body.nextCursor } },
})) {
  console.log(page.body.events.length);
}
```

- `next(response)` returns the next page: a URL (relative ones resolve against the page's URL), `{ url?, params? }` (`params` merge into the request's), or nothing for the last page. The default reads the `Link` header's `rel="next"`.
- The other options are the request options of every page (`headers`, `params`, `signal`, `timeoutMs`…). `maxPages` (default 1000) stops early; so does `break`, and no further page is requested. A `signal` that aborts rejects with a `CancelledError`.
- A next URL on **another origin** throws an `InvalidInputError` unless you set `crossOrigin: true`, so a server cannot send your requests, and the credentials in them, to another host. A server that links back to a page it already sent ends the iteration.
- A failing page rejects the iteration with its error, after the earlier pages were yielded. Use a plain object for `params` when you merge a cursor into them.

## Validating responses

`schema` takes any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType and others implement it; rust-fetch depends on none of them). The body of the response becomes the schema's output, typed as such.

```ts
import { z } from 'zod';

const User = z.object({ id: z.number(), name: z.string() });
const response = await client.get('/users/42', { schema: User });
response.body.name; // string, validated
```

- A body that fails rejects with a `ValidationError` carrying `issues`, the `method`, `url` and `status`. It is not retried: the response was fine, its content was not. `error.message` only counts the issues, because validators such as Valibot quote the received value in theirs and error messages end up in logs; read the values from `issues` when you need them.
- Async validators and transforms work: the output is whatever the schema returns.
- It works with every method that takes request options (`get`, `post`, `post_json`, `request`, `fetch`…). It cannot be combined with `responseType: 'stream'` or `'ndjson'` (an `InvalidInputError`).
- The type guard is `isValidationError(error)`.
- `ValidationError` is a new `kind`, and it only appears when you pass `schema`. If you handle errors in a `switch` over `error.kind` with an exhaustive check, add a case for it.

