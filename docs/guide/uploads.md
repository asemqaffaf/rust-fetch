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

`loaded` is the number of body bytes sent so far and `total` is the body's size. A retried request starts again from 0. Exceptions thrown by the callback are ignored, and requests without a body report nothing. It works with `onDownloadProgress` on the same request, but not with `responseType: 'stream'`.

How it's sent:
- **Browsers:** `fetch()` has no upload progress events, so these requests go through `XMLHttpRequest`, with the same redirects, credentials, timeouts, retries and errors. Like any `XMLHttpRequest` with an upload listener, a cross-origin request is always [preflighted](https://developer.mozilla.org/docs/Web/HTTP/CORS#preflighted_requests), so the server must answer `OPTIONS`. With `responseTimeoutMs` or `idleTimeoutMs`, fetch handles the request and progress is reported once when the response arrives. Where `XMLHttpRequest` doesn't exist (service workers), progress is reported once, when the response arrives.
- **Node.js:** the `node:http` transport (never the native one) writes the body in 64 KB chunks and reports each once it has been handed to the operating system.
