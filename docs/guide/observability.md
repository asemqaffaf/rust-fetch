# Observability

JavaScript clients can opt into timings, lifecycle hooks, structured debug output and bounded metrics. Request policy stays in the Rust core. Observers cannot change retry, admission, cancellation or destination checks.

```js
import { WasmClient } from 'rust-fetch';

const client = new WasmClient({
  timings: true,
  metrics: true,
  onRequestEnd: ({ method, url, timings }) => {
    console.log(method, url, timings.totalMs);
  },
});

const response = await client.get('https://api.example.com/users');
console.log(response.timings.attempts);
console.log(client.stats().latency);
```

## Timings and lifecycle

Enable timings with new WasmClient({ timings: true }). The response's timings contains queuedMs, retryDelayMs, totalMs and an attempts array. Each attempt has startMs (relative to the logical call), totalMs, status/error and ttfbMs. A null ttfbMs means the runtime cannot observe headers separately. Native and Node requests also report connectionReused, connectMs (including DNS/TLS) and tlsMs where available. Reused connections have zero connection setup time.

onRequestStart and onRequestEnd run once per logical HTTP request, outside interceptors. Queueing and retries are included. The start hook runs before request interceptors; the end hook uses the resolved request destination. Exceptions and rejected promises from these observers do not change the request outcome.

For streamed responses, the response resolves at headers. Timings finalize and onRequestEnd runs when the body reaches EOF, fails or is cancelled. Consume or cancel a body to finish its lifecycle. Metrics count an unread stream as active.

Errors identify method, url and attempts, including retries (redirects do not count as separate attempts). An invalid request has zero attempts. The URL is the last destination known to the transport; browsers cannot expose the final destination of an opaque network failure. Error messages remain unchanged. Where a transport supplies an underlying JavaScript error, requests preserve it as cause even with diagnostics disabled. A later retry's error never inherits a previous attempt's cause.

Convenience functions and SSE/WebSocket errors carry the same request/connection context. Reconnection callbacks count connection attempts; SSE HTTP retries are included in its error count. Constructor errors have no request to identify. User-thrown primitive interceptor rejections are preserved as primitives.

## Redaction and logging

debug: true writes structured entries to console.debug. debug: (entry) => logger.debug(entry) supplies a logger instead. In Node, DEBUG=rust-fetch enables the same logging; explicit debug: false wins.

Entries describe the request, resolved destination, transport, attempts, retries/delays, redirects and SSE/WebSocket connection changes. Header values for Authorization, Cookie, Proxy-Authorization, Set-Cookie and sensitiveHeaders are replaced with [REDACTED]. Bodies and error messages are never emitted by the built-in diagnostics. URL user info, fragments and query strings are removed before a log or lifecycle hook receives them.

Retry entries include `reason` (the error kind), HTTP `status` where available, `delayMs` (the actual configured wait) and `retryAfterMs` when supplied by the server. The configured maximum delay can cap the wait below the server's value. Diagnostics preserve frozen application errors; attaching optional timing fields to them is best effort.

Error objects delivered to application code retain their normal messages/bodies and full URLs by default, including query strings. Use redactUrl to redact error URLs before an application logs them. The callback also receives the already-sanitized URL used by diagnostics. It should be synchronous and idempotent; for example, parse the URL, clear search, username and password, and return href. A failing diagnostic redactor yields a safe URL rather than exposing its input.

These protections cover the library's own observers, not an application's interceptor, custom logger or arbitrary serialization of error bodies/causes. Avoid logging entire error objects from an untrusted upstream.

## W3C trace context

Automatic propagation is off by default. Set propagateTrace: true together with traceOrigins (exact HTTP origins) and a synchronous traceContext callback returning traceparent and optional tracestate. Invalid trace IDs, malformed state and duplicate state keys are rejected before sending.

The context provider runs after request interceptors resolve the destination. It is called only for allowlisted origins. Automatic trace headers are removed on every cross-origin Node/native redirect, including redirects to another allowlisted origin. Browser fetch cannot inspect a redirect before forwarding custom headers, so automatic tracing refuses browser redirects. Explicit application header values are not overwritten.

OpenTelemetry is optional; it is not a runtime dependency. Import context and propagation from the application's @opentelemetry/api installation, and inject the active context into a new carrier inside traceContext:

    traceContext: () => {
      const carrier = {};
      propagation.inject(context.active(), carrier);
      return carrier.traceparent ? carrier : undefined;
    }

Only traceparent and tracestate are forwarded; baggage is not implicitly propagated. Keep the origin allowlist narrow.

## Metrics

Set metrics: true to collect from construction. Alternatively, the first client.stats() call enables collection for subsequent requests. Snapshots are detached copies.

The snapshot has per-client request/attempt/retry counts and latency count, minimum, maximum, mean and p50/p95/p99. Percentiles use at most the latest 1,024 samples; totals retain cumulative counts. Origin labels are bounded. Polling does not retain bodies, request objects, headers or query strings.

Node snapshots also contain pools: the adapter's transport queue and per-origin native/http connection counts. Pools are shared by clients in one adapter module, while request/latency counters belong to the client. opened = idle + busy + closed for each pool snapshot. Queued requests are counted separately from connections. Node socket accounting begins with observed requests; idle native origin entries are bounded and counters reset when an entry is evicted. Active native origin handles are preserved. Browser network-pool counters are not exposed by the platform and pools is null.

For OpenTelemetry metrics, poll stats() in observable-gauge callbacks for active, queued, idle and busy counts. Record per-request totalMs in a histogram through onRequestEnd. Do not use full URLs as metric labels; use an application route name or a bounded origin label. Handle counter resets after pool eviction.

This API is for JavaScript runtimes. The Rust crate's existing request/response/error API remains compatible; Rust applications can apply their own instrumentation around requests.
