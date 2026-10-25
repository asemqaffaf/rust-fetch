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
| `reconnect` | `true`, a maximum number of attempts in a row, or `{ maxRetries, initialDelayMs, maxDelayMs, multiplier }` (defaults: unlimited, 1000, 30000, 2). Off by default |
| `messageType` | `'auto'` (default: text as strings, binary as `Uint8Array`) or `'json'` |
| `signal` | Closes the connection and stops reconnecting when aborted |
| `onOpen`, `onMessage`, `onError`, `onReconnect`, `onClose` | Callbacks; `onClose` runs once, when the connection is closed for good |

Failures are typed like request errors: a refused or failed connection is a `NetworkError`, an attempt that takes too long a `TimeoutError`, a JSON message that doesn't parse a `ParseError`, and closing before the first connection opens rejects `opened` with a `CancelledError`. With `reconnect`, a failed attempt or an unexpected drop (close codes 1001, 1006 and 1011–1014) is retried with jittered exponential backoff, and the count resets once a connection opens. A server that closes normally (1000) or with its own code isn't reconnected to. An exception thrown by a callback doesn't affect the connection; it's reported as an unhandled promise rejection. As with an exception in a handler of the platform's own `WebSocket`, Node.js then ends the process unless you handle it (`process.on('unhandledRejection', …)`), so catch errors inside your callbacks.

`send()` takes a string, `ArrayBuffer`, typed array, `DataView` or `Blob`; `sendJson()` takes any JSON value. `close(code, reason)` takes 1000 (the default) or 3000–4999.
