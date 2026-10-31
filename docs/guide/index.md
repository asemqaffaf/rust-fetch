# Guide overview

Every method and the options you'll use most, on one page, with links to the details. New to rust-fetch? Start with [Getting started](/guide/getting-started), then read in this order:

1. [Client options](/guide/configuration) and [Requests and responses](/guide/requests): what a client holds, and what each call takes and returns.
2. [Errors](/guide/errors) and [Timeouts, retries and cancellation](/guide/timeouts-and-retries): what can fail, and what the client does about it.
3. [Interceptors](/guide/interceptors): auth headers, token refresh and logging in one place.
4. What your app needs: [Streaming and Server-Sent Events](/guide/streaming), [Uploads](/guide/uploads), [WebSockets](/guide/websockets), [TypeScript](/guide/typescript).
5. Before production: [Security](/security), the [hardened configurations](/security#hardened-configurations) to copy, and [Observability](/guide/observability).

## Client methods

```js
import { WasmClient } from 'rust-fetch';

const client = new WasmClient({ baseUrl: 'https://api.example.com/v1' });
```

| Method | Returns | Details |
| --- | --- | --- |
| `get`, `head`, `delete(url, options?)` | `Promise<HttpResponse>` | [Making requests](/guide/requests#making-requests) |
| `post`, `put`, `patch(url, { body, ...options })` | `Promise<HttpResponse>` | [Request bodies](/guide/requests#request-bodies) |
| `fetch(url, { method, body, ...options })` | `Promise<HttpResponse>` | [Making requests](/guide/requests#making-requests) |
| `post_json`, `put_json`, `patch_json(url, body, options?)` | `Promise<HttpResponse>` | Always send `body` as JSON |
| `request(method, url, headers?, body?, options?)` | `Promise<HttpResponse>` | Fully positional |
| `events(url, options?)` | `EventStream` | [Server-Sent Events](/guide/streaming#server-sent-events) |
| `websocket(url, options?)` | `WebSocketConnection` | [WebSockets](/guide/websockets#websockets) |
| `addRequestInterceptor(fn)`, `addResponseInterceptor(onFulfilled?, onRejected?)` | an id | [Interceptors](/guide/interceptors#interceptors) |
| `ejectInterceptor(id)`, `clearInterceptors()` | | [Interceptors](/guide/interceptors#interceptors) |
| `retriesRefused` | number | Retries the [retry budget](/guide/timeouts-and-retries#retries) refused |
| `stats()` | `ClientStats` | Detached request, latency and Node connection-pool snapshots; enables collection for subsequent requests. See [Observability](/guide/observability#metrics) |

## Common client options

Set once, on `new WasmClient({ … })`. The full list is in [Client options](/guide/configuration#client-options).

| Option | Default | What it does |
| --- | --- | --- |
| `baseUrl` | none | Relative request URLs resolve under it |
| `headers` | none | Sent with every request; a request header with the same name wins |
| `timeoutMs` | `30000` | Per attempt, until the last byte of the body; `0` disables it |
| `retries` | no retries | A count, or `{ maxRetries, initialDelayMs, maxDelayMs, multiplier, retryOn, … }` |
| `retryBudget` | no budget | `true` limits retries across the client, against retry storms |
| `redirect`, `maxRedirects` | `'follow'`, `20` | Or `'manual'` / `'error'` |
| `maxResponseBytes` | no limit | Largest response body, after decompression |
| `maxPendingRequests` | no limit | Refuse requests beyond this many unfinished ones |
| `allowAbsoluteUrls` | `true` | `false` keeps request URLs under `baseUrl` |
| `allowPrivateNetwork` | `true` | `false` blocks loopback, private and metadata addresses (Node.js) |
| `proxy` | none | `'env'` or a proxy URL (Node.js) |

## Common request options

Passed to each call; most override the client option of the same name. The full list is in [Request options](/guide/requests#request-options).

| Option | What it does |
| --- | --- |
| `body` | For `post`, `put`, `patch` and `fetch`: objects become JSON; strings, bytes, `Blob`, `FormData` and `URLSearchParams` are sent as they are |
| `headers` | Override client headers with the same name |
| `params` | Appended to the query string; arrays repeat the key |
| `timeoutMs` | Overrides the client timeout |
| `signal` | An `AbortSignal` that cancels the request, its retries and its body |
| `responseType` | `'auto'` (by `Content-Type`), `'json'`, `'text'`, `'binary'`, `'stream'` or `'ndjson'` |
| `onDownloadProgress`, `onUploadProgress` | `({ loaded, total }) => void` |

## What a request resolves to

A 2xx response (or a redirect, with `redirect: 'manual'`) resolves to `{ status, statusText, ok, url, headers, body }`, with lower-cased header names and `body` decoded by `Content-Type` ([Responses](/guide/requests#responses)). Anything else rejects with an `Error` whose `kind` is `HttpError`, `TimeoutError`, `NetworkError`, `CancelledError`, `InvalidInputError`, `ParseError` or `JsInteropError` ([Errors](/guide/errors#errors)).
