# Uploads

## File uploads

Pass a `FormData` and it's sent as `multipart/form-data`, files included:

```js
const form = new FormData();
form.append('title', 'Quarterly report');
form.append('file', new File(['%PDF-1.7 …'], 'report.pdf', { type: 'application/pdf' })); // or a file from <input type="file">
await client.post('/upload', { body: form });
```

A single `Blob` or `File` body is sent as raw bytes with the blob's type.

## Streaming request bodies (2.7.0, unreleased)

Pass a `ReadableStream` or async iterable of strings, `ArrayBuffer`s or byte views. Node.js `Readable` streams work directly. The transport pulls another chunk when it can accept more data; it does not collect the upload in WebAssembly memory. `GET` and `HEAD` cannot carry a streaming body.

```js
import { createReadStream } from 'node:fs';

// A one-shot source: automatic retries are disabled for this request.
await client.put('/archive', { body: createReadStream('archive.tar') });

// A factory supplies a fresh source for every attempt.
await client.put('/archive', {
  body: () => createReadStream('archive.tar'),
  retries: { maxRetries: 2 },
  onUploadProgress: ({ loaded }) => console.log(`${loaded} bytes handed to transport`),
});
```

A factory can return a promise. Factories open on admission, so cancellation while queued does not open a file or start a producer. Aborts, deadlines and transport failures cancel an active reader and destroy a Node readable. A cancelled one-shot source is closed even if it has not been read yet. A producer's own pending asynchronous work still needs its own cancellation mechanism when its iterator cannot interrupt `next()`.

A one-shot body is never automatically retried, including with an idempotency key or `retryNonIdempotent: true`. A factory still follows the ordinary method and idempotency retry rules. In Node.js, a redirect that preserves a streaming body requires a factory; redirects that rewrite the method to `GET` discard the body. SSE reconnection also requires a factory (`reconnect: false` permits a one-shot body).

Both `node:http` and the native addon send streaming uploads. A generated **3 GiB** upload and a paused receiver are tested against each transport. The addon pulls one chunk at a time from JavaScript; it does not accumulate an unbounded channel of chunks. Proxies, streamed responses and requests with progress callbacks use `node:http` as usual. An explicit zero `Content-Length` also uses `node:http` to validate the empty source. Other explicit lengths must be nonnegative safe integers and match the source exactly. The transport sets `Transfer-Encoding`; explicit values are rejected for streaming bodies. Omit `Content-Length` for unknown sizes; Node sends them with chunked framing.

Browsers use `fetch()` with `duplex: 'half'`. Responses become available after the upload finishes; this API does not provide a bidirectional HTTP conversation. The basic `Request` feature check rejects Firefox with `InvalidInputError` on `body`, before pulling it. CI sends real uploads over HTTP/2 in Chromium and macOS WebKit. Linux WebKit accepts the `Request` but its [Soup backend rejects streaming bodies](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/NetworkProcess/soup/NetworkDataTaskSoup.cpp); fetch reports `NetworkError`. WebKit may read the producer's first chunk before that rejection arrives; no upload bytes reach the server, and the producer is cancelled. The constructor check cannot detect that network-backend restriction. CI tests this rejection separately and runs WebKit uploads on macOS. Chromium and macOS WebKit reject the HTTP/1.1 test. Browser streaming uploads require HTTP/2 or HTTP/3, cannot use `keepalive` or `no-cors`, and require a CORS preflight across origins. Browsers reject body-preserving redirects even with a factory; use the final upload URL. These restrictions come from [browser fetch streaming](https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests) and the [Fetch redirect rules](https://fetch.spec.whatwg.org/#http-redirect-fetch).

For a streaming body, progress counts bytes handed to the transport, rather than bytes acknowledged by the server: Node's write callbacks or chunks enqueued for browser fetch. `total` is `0` when unknown, or the explicit `Content-Length` in Node. A replay starts its count again. Streaming uploads can use `responseType: 'stream'` or `'ndjson'` with upload progress.

## Upload progress

Report how much of a request body has been sent, for example to drive a progress bar:

```js
const form = new FormData();
form.append('video', new Blob([new Uint8Array(50_000_000)]), 'video.mp4');

await client.post('/upload', {
  body: form,
  onUploadProgress: ({ loaded, total }) => {
    console.log(`${Math.round((loaded / total) * 100)}% uploaded`);
  },
});
```

`loaded` is the number of body bytes sent so far and `total` is the body's size. A retried request starts again from 0. Exceptions thrown by the callback are ignored, and requests without a body report nothing. It works with `onDownloadProgress` on the same request. Buffered uploads cannot combine this callback with `responseType: 'stream'`; streaming request bodies can.

For buffered bodies, how it's sent:
- **Browsers:** `fetch()` has no upload progress events, so these requests go through `XMLHttpRequest`, with the same redirects, credentials, timeouts, retries and errors. Like any `XMLHttpRequest` with an upload listener, a cross-origin request is always [preflighted](https://developer.mozilla.org/docs/Web/HTTP/CORS#preflighted_requests), so the server must answer `OPTIONS`. With `responseTimeoutMs` or `idleTimeoutMs`, fetch handles the request and progress is reported once when the response arrives. Where `XMLHttpRequest` doesn't exist (service workers), progress is reported once, when the response arrives.
- **Node.js:** the `node:http` transport (never the native one) writes the body in 64 KB chunks and reports each once it has been handed to the operating system.
