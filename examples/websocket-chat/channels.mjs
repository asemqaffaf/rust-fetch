// Channels over a WebSocket: the recipe behind the recommendation on #154.
// The server owns membership; this keeps a client-side list of channels and subscribes again after every reconnect,
// the part that is easy to forget. The envelope is yours: `subscribe`, `unsubscribe` and the field names are options.
import { pathToFileURL } from 'node:url';
import init, { WasmClient } from 'rust-fetch';

export function channelSocket(client, url, {
  maxChannels = 100,
  field = 'channel',
  subscribe = (name) => ({ type: 'subscribe', [field]: name }),
  unsubscribe = (name) => ({ type: 'unsubscribe', [field]: name }),
  onOpen,
  onMessage,
  ...options
} = {}) {
  const handlers = new Map(); // channel name -> Set of listeners
  const join = (name) => { try { socket.sendJson(subscribe(name)); } catch { /* queued or closed: onOpen subscribes again */ } };
  const socket = client.websocket(url, {
    ...options,
    messageType: 'json',
    // Fires on the first connection and after every reconnect: subscribe to everything again
    onOpen: (event) => { for (const name of handlers.keys()) join(name); onOpen?.(event); },
    onMessage: (message) => {
      const listeners = handlers.get(message?.[field]);
      if (listeners) for (const listener of listeners) listener(message.data ?? message);
      else onMessage?.(message);
    },
  });

  function channel(name, listener) {
    if (!handlers.has(name)) {
      if (handlers.size >= maxChannels) throw new RangeError(`More than ${maxChannels} channels`);
      handlers.set(name, new Set());
      if (socket.state === 'open') join(name);
    }
    handlers.get(name).add(listener);
    return () => { // leave
      const listeners = handlers.get(name);
      if (!listeners?.delete(listener) || listeners.size) return;
      handlers.delete(name);
      if (socket.state === 'open') socket.sendJson(unsubscribe(name));
    };
  }
  return { socket, channel, get channels() { return [...handlers.keys()]; } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.URL;
  if (!url) throw new Error('Set URL, for example URL=wss://api.example.com/live');
  await init();
  const { socket, channel } = channelSocket(new WasmClient(), url, { reconnect: true });
  channel('prices', (data) => console.log('prices', data));
  await socket.closed;
}
