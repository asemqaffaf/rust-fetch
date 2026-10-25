# Streaming and Server-Sent Events

## Streaming

`responseType: 'stream'` resolves as soon as the headers arrive. `body` is then a `ReadableStream<Uint8Array>`:

```js
const res = await client.get('/export.csv', { responseType: 'stream' });
let received = 0;
for await (const chunk of res.body) {
  received += chunk.byteLength; // each chunk is a Uint8Array
}
console.log(`${received} bytes`);
```

`for await` over a stream works in Node.js, Chrome and Firefox. Safari doesn't support it yet, so use `res.body.getReader()` there. Retries apply until the headers arrive, and error statuses still reject with an `HttpError`.

**Memory while streaming.** A stream is read as fast as you read it, not as fast as the server sends:
- **Node.js:** a slow reader holds the server back. Only what the socket and stream buffers hold is read ahead: in a test, a server offering 64 MB had sent about 1.5 MB (0.8 MB as NDJSON) while the reader paused for a second. That's reduced read-ahead, not a fixed ceiling, since buffer sizes depend on the platform. Browsers read a response ahead of the page themselves (their own `fetch()` took 59–64 MB in the same test), so this applies to Node.js only.
- **Cancelling releases the connection:** `reader.cancel()`, `break` out of `for await`, an aborted `signal`, or reaching `maxResponseBytes` closes it on every transport. A body you drop without reading or cancelling is closed when it's garbage-collected, so cancel one you don't need.
- **Each chunk is yours:** every `Uint8Array` you receive owns its whole buffer, and rust-fetch keeps no reference to it. Without download progress or `maxResponseBytes`, chunks are handed over from the transport as they arrive, without copying them through WebAssembly; with either, rust-fetch reads each one on its way, so it's copied.
- **Per-line and per-event limits** for NDJSON and Server-Sent Events: [`maxLineBytes` and `maxEventBytes`](/security#limiting-line-length).

These are checked on every transport by the [conformance suite](/conformance).

**Newline-delimited JSON** (NDJSON, JSON Lines), as streamed by Ollama, many search and log APIs, and Kubernetes watches: with `responseType: 'ndjson'`, `body` is a `ReadableStream` of parsed values, one per line, as each line arrives:

```js
const res = await client.post('/api/generate', { body: { model: 'llama3', prompt: 'Why is the sky blue?' }, responseType: 'ndjson' });
for await (const chunk of res.body) {
  console.log(chunk.response);
}
```

Lines may be split across network chunks, end in `\n` or `\r\n`, and the last one doesn't need a newline; empty lines are skipped. A line that isn't JSON errors the stream with a `ParseError` naming the line number. A line can be any length unless you set [`maxLineBytes`](/security#limiting-line-length).

## Server-Sent Events

`client.events()` reads a [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) stream. Unlike the browser's `EventSource`, it works in Node.js too, sends any method, headers and body, and uses the client's base URL, interceptors, timeouts and typed errors.

```js
// A streaming LLM API: POST a JSON body, read JSON events until `data: [DONE]`
const stream = client.events('/v1/chat/completions', {
  method: 'POST',
  body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hello' }], stream: true },
  headers: { authorization: 'Bearer your-api-key' },
  messageType: 'json',
});
for await (const { data } of stream) {
  console.log(data.choices[0].delta.content ?? '');
}

// A notification feed: callbacks, reconnecting with Last-Event-ID
const feed = client.events('/notifications', {
  onEvent: ({ event, data, id }) => console.log(event, data, id),
  onError: (error) => console.warn(error.kind, error.message),
});
await feed.opened;
feed.close();
```

Each event is `{ event, data, id }`: `event` is `'message'` unless the server set one, `data` is the `data:` lines joined with `\n` (or parsed JSON with `messageType: 'json'`), and `id` is the last event ID. Events go to `onEvent` when it's set; otherwise they're buffered for `for await`, and `break` closes the stream. A `for await` loop that falls behind holds the server back: with 64 events waiting, the stream stops reading until the loop has taken half of them, so demand propagates to the server instead of every event piling up in memory. This reduces read-ahead rather than setting a memory ceiling: the socket and stream buffers still fill (in a test, a server offering 20 MB of events wrote about 830 KB during a one-second pause, against 12 MB before). `onEvent` gets each event as it's parsed, so a slow handler should apply its own limit. To bound a single line or event, see [`maxLineBytes` and `maxEventBytes`](/security#limiting-line-length).

| Option | Description |
| --- | --- |
| `method`, `body`, `headers`, `params`, `timeoutMs` | As for requests. `timeoutMs` covers each connection attempt until the response headers arrive |
| `reconnect` | Reconnect after the stream ends or a connection fails, sending `Last-Event-ID` and waiting the server's `retry:` delay (otherwise backing off like WebSockets). `true`, a maximum number of attempts in a row, or `{ maxRetries, initialDelayMs, maxDelayMs, multiplier }`. Default: on for `GET`, off for other methods, which would resend their body |
| `messageType` | `'auto'` (default: `data` is a string) or `'json'` |
| `end` | Close the stream normally when an event's `data` equals this. Default: `'[DONE]'` with `messageType: 'json'` |
| `maxLineBytes`, `maxEventBytes` | Override the client's limits for this stream; `null` for none. See [Limiting line length](/security#limiting-line-length) |
| `allowAbsoluteUrls` | Overrides the client's |
| `signal` | Closes the stream and stops reconnecting when aborted |
| `onOpen`, `onEvent`, `onError`, `onReconnect`, `onClose` | Callbacks; `onClose` runs once, when the stream is closed for good |

The stream also has `url`, `state` (`'connecting'`, `'open'`, `'reconnecting'` or `'closed'`), `lastEventId`, and `opened` and `closed` promises. Failures are typed: a refused connection or dropped stream is a `NetworkError`, a response that isn't `text/event-stream` a `ParseError`, an error status an `HttpError` (408, 429 and 5xx are reconnected after, others end the stream), and a `204 No Content` ends it normally. With `messageType: 'json'`, a `data` that isn't JSON goes to `onError`; when iterating, it ends the stream with the `ParseError`. Request interceptors run before each connection.

## Download progress

```js
await client.get('/video.mp4', {
  responseType: 'binary',
  onDownloadProgress: ({ loaded, total }) => {
    console.log(total ? `${Math.round((loaded / total) * 100)}%` : `${loaded} bytes`);
  },
});
```

The callback runs after each chunk of a successful response, including streamed ones. `total` comes from `Content-Length` and is `null` when the server doesn't send it. Exceptions thrown by the callback are ignored.
