// A WebSocket chat client that reconnects by itself and queues messages while it is away.
// Run it:  URL=wss://chat.example.com/room node examples/websocket-chat/index.mjs
import { pathToFileURL } from 'node:url';
import init, { WasmClient } from 'rust-fetch';

export async function run({ url, expected = 1, log = console.log }) {
  await init();
  const client = new WasmClient({ retries: 0 });
  const received = [];
  const reconnects = [];
  let done;
  const finished = new Promise((resolve) => { done = resolve; });

  const chat = client.websocket(url, {
    reconnect: { initialDelayMs: 20, maxDelayMs: 200 },
    messageType: 'json',
    onOpen: () => log('connected'),
    onMessage: (message) => { received.push(message); if (received.length >= expected) done(); },
    onReconnect: (attempt) => { reconnects.push(attempt); log('reconnecting'); },
  });

  await chat.opened;
  chat.sendJson({ type: 'hello', name: 'Ada' }); // queued if the connection drops first
  await finished;
  chat.close(1000, 'bye');
  const closed = await chat.closed;
  return { received, reconnects: reconnects.length, closeCode: closed.code };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.URL;
  if (!url) throw new Error('Set URL, for example URL=wss://chat.example.com/room');
  console.log(await run({ url, expected: 5 }));
}
