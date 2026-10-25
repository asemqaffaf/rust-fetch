# Interceptors

```js
const token = 'your-access-token'; // e.g. from your auth flow

// Add a header to every request (may be async)
client.addRequestInterceptor((request) => {
  request.headers.authorization = `Bearer ${token}`;
  // mutate in place, or return a new { method, url, headers, body }
});

// Resolve to the body instead of the whole response
client.addResponseInterceptor((response) => response.body);

// Report failures, then keep rejecting
client.addResponseInterceptor(undefined, (error) => {
  console.error('request failed:', error.kind, error.message);
  throw error;
});
```

An `onRejected` handler can also recover by returning a value, for example the result of retrying the request after refreshing a token.

- Request interceptors run in order before each request. They see `{ method, url, headers, body }`, where `headers` holds the per-request headers. Client default headers are added afterwards, and a request header with the same name wins.
- Response interceptors chain like `promise.then(onFulfilled, onRejected)`. Their return values are what the call resolves to. Throw to reject.
- `addRequestInterceptor` and `addResponseInterceptor` return an id for `ejectInterceptor(id)`. `clearInterceptors()` removes all of them.
- A request uses the interceptors registered when it started.
- Interceptors apply to HTTP requests, not to WebSockets.
