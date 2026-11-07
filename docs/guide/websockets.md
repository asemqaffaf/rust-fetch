# WebSockets

Available in browsers and in Node.js 22 and newer (Node.js 20 needs `--experimental-websocket`).

```js
const socket = client.websocket('/live', {     // wss://api.example.com/v1/live?room=blue
  params: { room: 'blue' },
  messageType: 'json',                         // parse text messages as JSON
  reconnect: true,                             // after failures and unexpected drops, 1 s doubling to 30 s
  onMessage: (message) => console.log('received', message),
  onError: (error) => console.warn(error.kind, error.message),
  onReconnect: ({ attempt, delayMs }) => console.log(`reconnecting in ${delayMs} ms (attempt ${attempt})`),
});

await socket.opened;                           // rejects with a typed error if it never connects
socket.sendJson({ type: 'subscribe', channel: 'prices' });
socket.close();                                // stops reconnecting
const { code, reason, wasClean } = await socket.closed;
```

In Node.js you can authenticate the handshake with headers, which browsers don't allow:

```js
const authed = client.websocket('/live', { headers: { authorization: 'Bearer your-access-token' } }); // Node.js only
```

Early Node.js 20 releases (20.11 tested) fail to connect when offered more than one subprotocol, a bug in their WebSocket that later 20.x releases fixed (20.20 tested). `websocket()` resolves relative URLs against `baseUrl`, turning `http:` into `ws:` and `https:` into `wss:`, and returns at once; messages sent before the connection opens (or while it reconnects) are queued. That queue has no limit unless you set one: with `maxQueuedMessages` and/or `maxQueuedBytes` (UTF-8 bytes for text, the size of binary data and Blobs), a `send()` that would go over throws a `NetworkError` carrying the limit it reached, and the message isn't queued. Once the connection is open, messages go to the runtime's socket, whose own buffer is `bufferedAmount`. `state` is `'connecting'`, `'open'`, `'reconnecting'`, `'closing'` or `'closed'`.

| Option | Description |
| --- | --- |
| `protocols` | Subprotocols to offer; the chosen one is `socket.protocol` |
| `params` | Appended to the query string |
| `headers` | Handshake headers, merged over the client's. Node.js only: browsers don't allow WebSocket headers, so passing them there throws an `InvalidInputError`, and the client's headers aren't sent |
| `dispatcher` | Node.js only: an [undici](https://undici.nodejs.org) dispatcher for the connection, e.g. `new ProxyAgent('http://proxy:3128')` to connect through a proxy (see below). Browsers use the system's proxy settings, so passing one there throws an `InvalidInputError` |
| `timeoutMs` | Time allowed for each connection attempt; defaults to the client's `timeoutMs`, `0` disables it |
| `idleTimeoutMs` | Maximum silence after opening or between received messages; inherits the client's `idleTimeoutMs`, `0` disables it. Expiry reports `TimeoutError` with `phase: 'idle'` and follows `reconnect`. No heartbeat messages are sent |
| `reconnect` | `true`, a maximum number of attempts in a row, or `{ maxRetries, initialDelayMs, maxDelayMs, multiplier }` (defaults: unlimited, 1000, 30000, 2). Off by default |
| `messageType` | `'auto'` (default: text as strings, binary as `Uint8Array`) or `'json'` |
| `maxQueuedMessages`, `maxQueuedBytes` | Limits on what `send()` queues before the connection opens or while it reconnects (see above). Default: no limit |
| `allowAbsoluteUrls` | Overrides the client's |
| `allowPrivateNetwork` | Node.js: overrides the client's; see [SSRF](/security#fetching-user-supplied-urls-ssrf) |
| `signal` | Closes the connection and stops reconnecting when aborted |
| `onOpen`, `onMessage`, `onError`, `onReconnect`, `onClose` | Callbacks; `onClose` runs once, when the connection is closed for good |

Failures are typed like request errors: a refused or failed connection is a `NetworkError`, an attempt that takes too long a `TimeoutError`, a JSON message that doesn't parse a `ParseError`, and closing before the first connection opens rejects `opened` with a `CancelledError`. With `reconnect`, a failed attempt or an unexpected drop (close codes 1001, 1006 and 1011–1014) is retried with jittered exponential backoff, and the count resets once a connection opens. A server that closes normally (1000) or with its own code isn't reconnected to. An exception thrown by a callback doesn't affect the connection; it's reported as an unhandled promise rejection. As with an exception in a handler of the platform's own `WebSocket`, Node.js then ends the process unless you handle it (`process.on('unhandledRejection', …)`), so catch errors inside your callbacks.

`send()` takes a string, `ArrayBuffer`, typed array, `DataView` or `Blob`; `sendJson()` takes any JSON value. `close(code, reason)` takes 1000 (the default) or 3000–4999.

## Request and response

`websocket()` has no built-in request/response, because there is no standard for it: servers name the id field and shape their replies differently (`id`, `requestId`, `ack`…), and what a reconnect should do with a request in flight depends on whether resending it is safe. The [`request.mjs` recipe](https://github.com/asemqaffaf/rust-fetch/blob/main/examples/websocket-chat/request.mjs) is about sixty lines and tested in CI: it adds an id to each outgoing message, resolves with the first reply carrying it, passes every other message to your `onMessage`, and rejects (never hangs) on a timeout, an abort, a drop (the message may have been delivered, so it is never resent for you), a close, or too many pending requests. Rename `idField` to match your server and copy it into your project.

```js
const { socket, request } = requestSocket(client, '/rpc', { idField: 'requestId', reconnect: true });
await socket.opened;
const reply = await request({ type: 'getUser', userId: 42 }, { timeoutMs: 3000 });
```

## Compared with Socket.IO

`client.websocket()` speaks the standard WebSocket protocol. [Socket.IO](https://socket.io/docs/v4/) does not: its documentation says it is "NOT a WebSocket implementation", and that a WebSocket client cannot connect to a Socket.IO server, nor a Socket.IO client to a plain WebSocket server. So the first question is what is on the other end.

| | `client.websocket()` | Socket.IO |
| --- | --- | --- |
| Protocol | Standard WebSocket (RFC 6455) | Its own protocol, carried over HTTP long-polling and WebSocket |
| Server | Any WebSocket server | A Socket.IO server (Node.js is the reference implementation; others exist) |
| Fallback when WebSocket is blocked | None | Falls back to HTTP long-polling |
| Reconnection | Opt-in, with jittered exponential backoff | Automatic, with exponential backoff |
| Acknowledgements (reply to a message) | No built-in; a [tested recipe](#request-and-response) covers it ([#153](https://github.com/asemqaffaf/rust-fetch/issues/153)) | Yes, a callback on `emit()` |
| Rooms, namespaces, broadcast | No ([#154](https://github.com/asemqaffaf/rust-fetch/issues/154), under evaluation); broadcast is a server job | Yes (rooms and broadcast are server-side concepts) |
| Also an HTTP client | Yes: one client for requests, Server-Sent Events and WebSockets, with the same retries, timeouts and typed errors | No |
| Clients | Browsers, Web Workers and Node.js | JavaScript (browsers, Node.js, React Native) and implementations in other languages, some by third parties |

**`websocket()` is enough when** you talk to a plain WebSocket (or Server-Sent Events) API, you want REST calls and live updates on one client with shared configuration, and you need reconnection, JSON messages and typed errors but not rooms, acknowledgements or a polling fallback.

**Socket.IO (or a hosted service such as Ably or Pusher) is still the right tool when** the backend is already Socket.IO, you rely on its rooms or acknowledgements, WebSockets are blocked on your users' networks, or you build heavy multi-user realtime features.

| Your situation | Use |
| --- | --- |
| A Socket.IO server | A Socket.IO client ([#155](https://github.com/asemqaffaf/rust-fetch/issues/155) evaluates a compatible client here) |
| A plain WebSocket or Server-Sent Events API | rust-fetch |
| REST and live updates from one client | rust-fetch |
| Rooms, acknowledgements or a long-polling fallback | Socket.IO |

The follow-ups are tracked, not promised: [acknowledgements](https://github.com/asemqaffaf/rust-fetch/issues/153), [channels](https://github.com/asemqaffaf/rust-fetch/issues/154) and [a Socket.IO-compatible client](https://github.com/asemqaffaf/rust-fetch/issues/155).

