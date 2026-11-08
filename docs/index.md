---
layout: home

hero:
  name: rust-fetch
  text: "<code>fetch()</code> plus the policy production code needs"
  tagline: Timeouts, retries, typed errors, streaming and security limits, from one Rust core that behaves the same in browsers, Web Workers and Node.js.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why rust-fetch?
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/asemqaffaf/rust-fetch

features:
  - title: Errors you can branch on
    details: Every failure rejects with a typed Error (HttpError with the status and body, TimeoutError, NetworkError, CancelledError…), so one catch handles them all.
    link: /guide/errors
  - title: Timeouts and retries done right
    details: timeoutMs covers each attempt up to the last byte of the body. Retries back off with jitter, honour Retry-After, never repeat a POST or PATCH unless you allow it, and can share a client-wide retry budget.
    link: /guide/timeouts-and-retries
  - title: Guards against servers and URLs you don't control
    details: Block private networks (SSRF, checked on the resolved address, for requests and WebSockets), cap response, line and event sizes, drop credentials on cross-origin redirects, refuse HTTPS downgrades.
    link: /security
  - title: Bounded under load
    details: Shed load beyond a pending-request limit, hold slow servers back with backpressure, and keep a few kilobytes per pending request, measured and budgeted in CI.
    link: /security#limiting-pending-requests-load-shedding
  - title: Streaming, SSE and WebSockets
    details: ReadableStream bodies, newline-delimited JSON and Server-Sent Events for LLM APIs, upload and download progress, and WebSockets with reconnection on the same client.
    link: /guide/streaming
  - title: One core, held to the same results
    details: The request policy is Rust compiled to WebAssembly. A conformance suite runs the same 69 behaviours on node:http, the native addon, fetch() and real browsers, and CI fails on any undocumented difference.
    link: /conformance
  - title: Typed, validated responses
    details: Pass a Zod, Valibot or ArkType schema (any Standard Schema) and the body is validated and typed as the schema's output. A body that fails rejects with a ValidationError that is never retried.
    link: /guide/requests#validating-responses
  - title: Auth, caching and deduplication
    details: Bearer or basic auth sent only to your origins, with single-flight token refresh; an opt-in RFC 9111 response cache; identical in-flight requests share one request.
    link: /guide/configuration
  - title: Easy to test
    details: Swap the transport for createMockTransport() in unit tests while the real retry, timeout, cancellation and error behaviour still runs.
    link: /guide/testing
---

```js
import { WasmClient } from 'rust-fetch';

const api = new WasmClient({
  baseUrl: 'https://api.example.com/v1',
  timeoutMs: 10_000, // per attempt, including reading the body
  retries: 3,        // exponential backoff with jitter; honours Retry-After
});

try {
  const { body: user } = await api.get('/users/42');
} catch (error) {
  if (error.kind === 'HttpError' && error.status === 404) {
    // not found: error.body has the response text
  } else {
    throw error;
  }
}
```
