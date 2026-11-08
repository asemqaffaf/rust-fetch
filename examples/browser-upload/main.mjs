// A file upload with a progress bar, in the browser, built with Vite (see README.md).
// Browsers have no upload progress in fetch(), so rust-fetch sends a body with a progress
// callback through XMLHttpRequest, with the same timeouts, retries and typed errors.
import init, { WasmClient, isCancelledError, isHttpError } from 'rust-fetch';

const bar = document.querySelector('#bar');
const status = document.querySelector('#status');
const send = document.querySelector('#send');
const cancel = document.querySelector('#cancel');
const file = document.querySelector('#file');

// The upload endpoint: ?api=https://... in the page's address, or /api on the same origin
const api = new URLSearchParams(location.search).get('api') ?? `${location.origin}/api`;

await init(); // compiles the WebAssembly module once, before the first request
const client = new WasmClient({ baseUrl: api, retries: 0, timeoutMs: 120_000 });

let controller;
send.addEventListener('click', async () => {
  const chosen = file.files?.[0];
  if (!chosen) {
    status.textContent = 'Choose a file first';
    return;
  }
  const form = new FormData();
  form.append('file', chosen);

  controller = new AbortController();
  send.disabled = true;
  cancel.disabled = false;
  bar.value = 0;
  status.textContent = 'Uploading…';
  try {
    const response = await client.post('/upload', {
      body: form,
      signal: controller.signal,
      // loaded and total are body bytes; a retry would start again from 0
      onUploadProgress: ({ loaded, total }) => {
        bar.max = total;
        bar.value = loaded;
        status.textContent = `Uploading… ${Math.round((loaded / total) * 100)}%`;
      },
    });
    status.textContent = `Uploaded ${response.body.received} bytes`;
  } catch (error) {
    if (isCancelledError(error)) status.textContent = 'Cancelled';
    else if (isHttpError(error)) status.textContent = `The server refused the upload (${error.status})`;
    else status.textContent = `Upload failed: ${error.kind ?? 'error'}`;
  } finally {
    send.disabled = false;
    cancel.disabled = true;
  }
});
cancel.addEventListener('click', () => controller?.abort());
