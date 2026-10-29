# Circuit breakers

A circuit breaker stops sending attempts to an unavailable API, then probes for recovery:

```js
const client = new WasmClient({
  circuitBreaker: { failureThreshold: 5, resetAfterMs: 30_000 },
  onCircuitChange: ({ origin, from, to }) => console.log(origin, from, to),
});
```

The feature is off by default. `circuitBreaker: {}` uses the values above. State is independent per origin (scheme, hostname and port), shared across a client and its Rust clones.

1. **Closed:** attempts proceed. Network errors, timeouts and HTTP 5xx increment the consecutive-failure count. Other responses, including 4xx, reset it. Cancelled attempts do not change it.
2. **Open:** after `failureThreshold` failures, new attempts reject immediately with `kind: 'CircuitOpenError'`, `origin` and `retryAfterMs`. No transport is called. Retries count as attempts and can open the circuit; an open circuit stops further retries.
3. **Half-open:** after `resetAfterMs`, exactly one admitted attempt probes recovery. Other callers fail fast while it runs. Success closes the circuit; another availability failure reopens it for the full interval. Cancelling the probe allows another probe immediately. Results from older in-flight attempts cannot close a newer open circuit.

```js
try {
  await client.get('/users');
} catch (error) {
  if (error.kind === 'CircuitOpenError') {
    console.log(error.origin, error.retryAfterMs);
  }
}
```

Concurrency/rate admission still applies to probes. An attempt rechecks the circuit after waiting for admission, so it cannot bypass a circuit that opened while it was queued. Blocked attempts do not spend retry budget or add first-attempt allowance.

For streamed responses and SSE, the attempt succeeds when successful response headers arrive; later body errors or reconnects are handled by the stream's policy. Each SSE connection attempt uses the circuit. Redirect hops belong to the original request origin. `websocket()` has its own reconnection policy and does not use the HTTP circuit.

`onCircuitChange` receives `{ origin, from, to }`, with states `'closed'`, `'open'` and `'half-open'`. It runs outside the state lock and receives no URL path, query, headers or body. A JavaScript hook that throws is reported as an unhandled promise rejection; it does not replace the request result.

In Rust, use `ClientBuilder::circuit_breaker(CircuitBreaker::new(5, Duration::from_secs(30)))` and optionally `on_circuit_change`. An open circuit has `error.kind() == "CircuitOpenError"`; `error.circuit_open()` exposes its origin and recovery delay. Its details are a typed source inside the existing `Error::Network` variant, preserving the exhaustive Rust error enum.

The TypeScript error-kind union gains `'CircuitOpenError'`. Exhaustive switches over that union need a new case even if a particular client leaves the feature off.
