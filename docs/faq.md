# FAQ

**How do I add retries and timeouts to `fetch()`?**
Use rust-fetch's client instead: `new WasmClient({ timeoutMs: 10_000, retries: 3 })` times out each attempt (including the body) and retries network errors, timeouts and 408/429/5xx responses with exponential backoff and jitter, honouring `Retry-After`. POST and PATCH aren't retried unless you opt in. See [Timeouts](/guide/timeouts-and-retries#timeouts) and [Retries](/guide/timeouts-and-retries#retries).

**Is rust-fetch an alternative to axios?**
Yes, for most uses: it rejects on HTTP errors, has interceptors, timeouts, upload and download progress, and adds built-in retries, typed errors and WebSockets, with the same client in browsers and Node.js. axios is much smaller in a browser bundle (about 21 KB against 131 KB brotli). See [Compared with `fetch()` and axios](/guide/introduction#compared-with-fetch-and-axios).

**Does it work in browsers and Node.js?**
Both, with the same API: browsers and Web Workers (through bundlers such as Vite and webpack; call `init()` first) and Node.js 20, 22 and 24. TypeScript definitions are included. See [Supported environments](/compatibility#supported-environments).

**Is it faster than `fetch()`?**
In Node.js, the published client matches `fetch()` one request at a time and is ahead with large bodies, many requests in flight and sustained load, but behind on concurrent HTTPS. The native transport, not in the npm package yet, reached up to 1.95× `fetch()`'s throughput. In browsers it uses `fetch()` itself. See [Performance](/performance#performance).

**How do I track upload progress?**
Pass `onUploadProgress: ({ loaded, total }) => …` to `post`, `put` or `patch`. See [Upload progress](/guide/uploads#upload-progress).

**How do I stream a response from an LLM API?**
For Server-Sent Events APIs (OpenAI-compatible and others), use `client.events(url, { method: 'POST', body, messageType: 'json' })` and `for await` over it; it stops at `data: [DONE]`. For newline-delimited JSON APIs such as Ollama, use `responseType: 'ndjson'`. Both work in browsers and Node.js. See [Server-Sent Events](/guide/streaming#server-sent-events).

**How do I reconnect a WebSocket automatically?**
`client.websocket(url, { reconnect: true })` reconnects after failures and unexpected drops with exponential backoff, and reports failures as typed errors. See [WebSockets](/guide/websockets#websockets).

**How do I type the response body in TypeScript?**
`client.get<User>('/users/42')` resolves to `HttpResponse<User>`. See [TypeScript](/guide/typescript#typescript).

**Do I need to know Rust?**
No. The npm package is used from JavaScript or TypeScript like any other; Rust is only how the core is built. Rust developers can also [use the crate directly](/rust#using-it-from-rust).
