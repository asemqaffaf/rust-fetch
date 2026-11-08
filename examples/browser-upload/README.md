# Upload with a progress bar (browser)

A page with a file input, an upload button, a progress bar and a cancel button, bundled with Vite.

```bash
npm install rust-fetch vite
npx vite                       # serves index.html; set ?api=https://your-server in the address
```

Your server needs `POST /upload` (multipart) and, when it is on another origin, CORS that answers the `OPTIONS` preflight: a request with an upload progress listener is always preflighted.

What it shows:

- `await init()` before the first request, as every browser build needs.
- `onUploadProgress({ loaded, total })` driving a `<progress>` element. Browsers have no upload progress in `fetch()`, so these requests go through `XMLHttpRequest` with the same timeouts, retries and typed errors.
- Cancelling with an `AbortSignal` (`isCancelledError`), and mapping a refused upload with `isHttpError`.

How it is tested: `wasm-module/js/test/bundlers.test.mjs` builds this folder with Vite 8 unchanged and drives it in Chromium against a local server: it picks a 3 MB file, checks that the bar moves in several steps and ends full, and checks the server received every byte, then cancels a second upload. Firefox and WebKit are not part of that test.
