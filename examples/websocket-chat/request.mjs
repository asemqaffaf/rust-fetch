// Request and response over a WebSocket: the recipe behind the recommendation on #153.
// An id on each outgoing message, the first reply carrying it resolves the request, and every
// pending request fails, rather than hanging, when the connection drops or closes.
// The id field and the replies are your server's convention, so they are options, not a built-in.
import { pathToFileURL } from 'node:url';
import init, { WasmClient } from 'rust-fetch';

const fail = (kind, message) => Object.assign(new Error(message), { name: kind, kind });

export function requestSocket(client, url, { idField = 'id', timeoutMs = 5000, maxPending = 100, onMessage, onReconnect, onClose, ...options } = {}) {
  const pending = new Map();
  let counter = 0;
  const failAll = (error) => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error()); }
    pending.clear();
  };
  const socket = client.websocket(url, {
    ...options,
    messageType: 'json',
    onMessage: (message) => {
      const entry = pending.get(message?.[idField]);
      if (!entry) return onMessage?.(message); // not a reply: a push from the server
      clearTimeout(entry.timer);
      pending.delete(message[idField]);
      entry.resolve(message);
    },
    // A drop means a request may or may not have reached the server: say so, and never resend on your own
    onReconnect: (event) => { failAll(() => fail('NetworkError', 'The connection dropped; the request may have been delivered')); onReconnect?.(event); },
    onClose: (event) => { failAll(() => fail('CancelledError', 'The connection was closed')); onClose?.(event); },
  });

  function request(message, { timeoutMs: timeout = timeoutMs, signal } = {}) {
    if (pending.size >= maxPending) return Promise.reject(fail('NetworkError', `More than ${maxPending} requests are waiting for a reply`));
    if (signal?.aborted) return Promise.reject(fail('CancelledError', 'The request was cancelled'));
    const id = `r${++counter}`;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: setTimeout(() => { pending.delete(id); reject(fail('TimeoutError', `No reply within ${timeout} ms`)); }, timeout) };
      pending.set(id, entry);
      signal?.addEventListener('abort', () => { if (pending.delete(id)) { clearTimeout(entry.timer); reject(fail('CancelledError', 'The request was cancelled')); } }, { once: true });
      try { socket.sendJson({ ...message, [idField]: id }); } catch (error) { pending.delete(id); clearTimeout(entry.timer); reject(error); }
    });
  }
  return { socket, request, get pending() { return pending.size; } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.URL;
  if (!url) throw new Error('Set URL, for example URL=wss://api.example.com/rpc');
  await init();
  const { socket, request } = requestSocket(new WasmClient(), url, { reconnect: true });
  await socket.opened;
  console.log(await request({ type: 'ping' }));
  socket.close();
}
