# rust-fetch in a Cloudflare Worker

`worker.mjs` answers `GET /users/:id` by asking another API, with two retries, a three-second timeout and an error response for each way the upstream can fail (not found, a bad status, a timeout, unreachable).

```bash
npm install rust-fetch
npx wrangler dev        # or: npx wrangler deploy
```

What Workers need that other runtimes don't:

- The `.wasm` file is imported as a module (`import wasm from 'rust-fetch/rust_fetch_bg.wasm'`) and passed to `init({ module_or_path: wasm })`. Workers cannot fetch and compile code at run time.
- Import the browser entry, `rust-fetch/rust_fetch.js`. The default `rust-fetch` entry is for Node.js.
- Workers have no `XMLHttpRequest`, so `onUploadProgress` is not available.

How it is tested: `wasm-module/js/test/runtimes/workers.mjs` starts `workerd`, the open-source runtime Workers run on, with this file as the Worker, and checks a success, an upstream 404, an upstream that fails twice and then answers (the retries), and an unknown route. A deployed Worker on Cloudflare's network is not tested.
