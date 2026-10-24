// WasmClient.websocket() in Node.js, against a local WebSocket server.
// Node.js has a global WebSocket from version 22; on Node.js 20 only the
// "not available" error is tested.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProxyAgent } from 'undici';
import { WasmClient } from '../../pkg/node.js';
import { rejection, sleep, startServer, startWebSocketServer } from './helpers.mjs';

const supported = typeof globalThis.WebSocket === 'function';

/** Resolves with the next value passed to the returned callback */
function nextCall() {
  let resolve;
  const calls = [];
  let waiting;
  const callback = (value) => {
    calls.push(value);
    resolve?.(value);
  };
  callback.calls = calls;
  callback.next = () => {
    waiting = new Promise((r) => (resolve = r));
    return waiting;
  };
  return callback;
}

it('fails with NetworkError where the runtime has no WebSocket', () => {
  const original = globalThis.WebSocket;
  delete globalThis.WebSocket;
  try {
    assert.throws(() => new WasmClient().websocket('ws://127.0.0.1:1/'), (error) => error.kind === 'NetworkError' && /Node\.js has it from version 22/.test(error.message));
  } finally {
    if (original) globalThis.WebSocket = original;
  }
});

describe('websocket', { skip: !supported && 'no global WebSocket (Node.js 20)' }, () => {
  let server;
  let peers = [];

  before(async () => {
    server = await startWebSocketServer((peer, req) => {
      peers.push(peer);
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/greet') peer.send('hello');
      if (url.pathname === '/drop-after-open') setTimeout(() => peer.drop(), 20);
      if (url.pathname === '/close-after-open') setTimeout(() => peer.close(4001, 'done'), 20);
      // Echo everything back
      peer.onmessage = (message) => peer.send(message);
    });
  });

  after(() => server.close());

  it('connects through the base URL with params, headers and protocols', async () => {
    const client = new WasmClient({ baseUrl: server.httpUrl('/v1'), headers: { authorization: 'Bearer a', 'x-default': '1' } });
    const socket = client.websocket('/live', {
      params: { room: 'blue' },
      headers: { authorization: 'Bearer b' },
      protocols: ['chat.v2', 'chat.v1'],
    });
    assert.equal(socket.url, `${server.url('/v1/live')}?room=blue`);
    assert.equal(socket.state, 'connecting');
    await socket.opened;
    assert.equal(socket.state, 'open');
    assert.equal(socket.protocol, 'chat.v2');
    const handshake = server.handshakes.at(-1);
    assert.equal(handshake.url, '/v1/live?room=blue');
    assert.equal(handshake.headers.authorization, 'Bearer b');
    assert.equal(handshake.headers['x-default'], '1');
    assert.equal(handshake.headers['sec-websocket-protocol'], 'chat.v2, chat.v1');
    socket.close();
    await socket.closed;
  });

  it('connects through a proxy with a dispatcher', { timeout: 5000 }, async () => {
    const tunnels = [];
    const proxy = http.createServer();
    proxy.on('connect', (req, socket, head) => {
      tunnels.push({ target: req.url, auth: req.headers['proxy-authorization'] });
      const { hostname, port } = new URL(`http://${req.url}`);
      const upstream = net.connect(Number(port), hostname, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      socket.on('error', () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const dispatcher = new ProxyAgent({ uri: `http://127.0.0.1:${proxy.address().port}`, token: 'Basic dXNlcjpwdw==' });
    try {
      const client = new WasmClient({ headers: { 'x-default': '1' } });
      const onMessage = nextCall();
      const greeting = onMessage.next();
      const socket = client.websocket(server.url('/greet'), { dispatcher, protocols: 'chat', onMessage });
      await socket.opened;
      assert.equal(await greeting, 'hello');
      assert.equal(server.handshakes.at(-1).headers['x-default'], '1');
      assert.deepEqual(tunnels, [{ target: new URL(server.url()).host, auth: 'Basic dXNlcjpwdw==' }]);
      socket.close();
      await socket.closed;
    } finally {
      await dispatcher.close();
      proxy.closeAllConnections?.();
      proxy.close();
    }
  });

  it('accepts ws: URLs and a single protocol string', async () => {
    const socket = new WasmClient().websocket(server.url('/plain'), { params: { a: 1 }, protocols: 'only' });
    assert.equal(socket.url, `${server.url('/plain')}?a=1`);
    await socket.opened;
    assert.equal(socket.protocol, 'only');
    socket.close();
    await socket.closed;
  });

  it('sends and receives text and binary messages, queueing until open', async () => {
    const onMessage = nextCall();
    const socket = new WasmClient().websocket(server.url('/greet'), { onMessage });
    const greeting = onMessage.next();
    socket.send('queued'); // before the connection opens
    assert.ok(socket.bufferedAmount >= 6);
    assert.equal(await greeting, 'hello');

    let reply = onMessage.next();
    assert.equal(await reply, 'queued');
    reply = onMessage.next();
    socket.send(new Uint8Array([1, 2, 3]));
    assert.deepEqual(await reply, new Uint8Array([1, 2, 3]));
    reply = onMessage.next();
    socket.send(new Uint16Array([0x0201]).buffer);
    assert.deepEqual(await reply, new Uint8Array([1, 2]));
    reply = onMessage.next();
    socket.send(new Blob(['blob']));
    assert.equal(Buffer.from(await reply).toString(), 'blob');
    reply = onMessage.next();
    socket.sendJson({ a: [1, 'two'] });
    assert.equal(await reply, '{"a":[1,"two"]}');

    socket.close(1000, 'bye');
    assert.equal(socket.state, 'closing');
    assert.deepEqual(await socket.closed, { code: 1000, reason: 'bye', wasClean: true });
    assert.equal(socket.state, 'closed');
  });

  it('limits messages queued before the connection opens, by count and by bytes', async () => {
    const onMessage = nextCall();
    const socket = new WasmClient().websocket(server.url('/echo'), { maxQueuedMessages: 3, maxQueuedBytes: 10, onMessage });
    const full = (option, limit) => (error) => error.kind === 'NetworkError' && error[option] === limit && /send queue is full/.test(error.message);
    socket.send('ëëëë'); // 8 bytes in UTF-8
    socket.send('a');
    assert.throws(() => socket.send('ab'), full('maxQueuedBytes', 10), '11 bytes');
    socket.send('b'); // exactly 10 bytes, 3 messages
    assert.equal(socket.bufferedAmount, 10);
    assert.throws(() => socket.send(''), full('maxQueuedMessages', 3), 'a 4th message');
    assert.throws(() => socket.sendJson(1), full('maxQueuedMessages', 3));
    await socket.opened;
    while (onMessage.calls.length < 3) await onMessage.next();
    assert.deepEqual(onMessage.calls, ['ëëëë', 'a', 'b'], 'only the accepted messages were sent, in order');
    // Once open, messages go straight to the socket
    const reply = onMessage.next();
    socket.send('x'.repeat(100));
    assert.equal(await reply, 'x'.repeat(100));
    socket.close();
    await socket.closed;
  });

  it('counts the queue from zero again while reconnecting', async () => {
    const onReconnect = nextCall();
    const socket = new WasmClient().websocket(server.url('/drop-after-open'), {
      reconnect: { initialDelayMs: 200, maxRetries: 3 },
      maxQueuedMessages: 2,
      maxQueuedBytes: 4,
      onReconnect,
    });
    socket.send('abcd');
    assert.throws(() => socket.send('e'), (e) => e.maxQueuedBytes === 4);
    await socket.opened;
    await onReconnect.next();
    assert.equal(socket.state, 'reconnecting');
    socket.send(new Blob(['wxy'])); // the queue was sent when the first connection opened
    assert.throws(() => socket.send(new Blob(['yz'])), (e) => e.maxQueuedBytes === 4, 'a Blob counts its size');
    socket.send(new Uint8Array(1));
    assert.throws(() => socket.send(new Uint8Array(0)), (e) => e.maxQueuedMessages === 2);
    socket.close();
    await socket.closed;
  });

  it("parses JSON messages with messageType: 'json'", async () => {
    const onMessage = nextCall();
    const onError = nextCall();
    const socket = new WasmClient().websocket(server.url('/json'), { messageType: 'json', onMessage, onError });
    await socket.opened;
    let reply = onMessage.next();
    socket.sendJson({ n: 1 });
    assert.deepEqual(await reply, { n: 1 });
    const failure = onError.next();
    socket.send('not json');
    const error = await failure;
    assert.equal(error.kind, 'ParseError');
    reply = onMessage.next();
    socket.send(new Uint8Array([9]));
    assert.deepEqual(await reply, new Uint8Array([9]));
    socket.close();
    await socket.closed;
  });

  it('calls onOpen and onClose, and rejects sends once closed', async () => {
    const onOpen = nextCall();
    const onClose = nextCall();
    const socket = new WasmClient().websocket(server.url('/close-after-open'), { onOpen, onClose });
    await socket.opened;
    assert.equal(onOpen.calls.length, 1);
    const info = await socket.closed;
    assert.deepEqual(info, { code: 4001, reason: 'done', wasClean: true });
    assert.deepEqual(onClose.calls, [info]);
    assert.throws(() => socket.send('late'), (error) => error.kind === 'NetworkError');
    socket.close(); // no-op once closed
  });

  it('reports a dropped connection without reconnect', async () => {
    const onError = nextCall();
    const socket = new WasmClient().websocket(server.url('/drop-after-open'), { onError });
    await socket.opened;
    const info = await socket.closed;
    assert.equal(info.code, 1006);
    assert.equal(info.wasClean, false);
    assert.equal(onError.calls.length, 1);
    assert.equal(onError.calls[0].kind, 'NetworkError');
    assert.match(onError.calls[0].message, /1006/);
  });

  it('reconnects after a dropped connection', async () => {
    const onOpen = nextCall();
    const onReconnect = nextCall();
    const socket = new WasmClient().websocket(server.url('/drop-after-open'), {
      reconnect: { initialDelayMs: 10, maxRetries: 3 },
      onOpen,
      onReconnect,
    });
    await socket.opened;
    const second = onOpen.next();
    const reconnect = await onReconnect.next();
    assert.equal(reconnect.attempt, 1);
    assert.ok(reconnect.delayMs >= 5 && reconnect.delayMs <= 10);
    assert.equal(reconnect.error.kind, 'NetworkError');
    assert.equal(socket.state, 'reconnecting');
    await second;
    assert.equal(socket.state, 'open');
    assert.equal(onReconnect.calls[0].attempt, 1);
    socket.close();
    await socket.closed;
  });

  it("doesn't reconnect after a deliberate close by the server", async () => {
    const onReconnect = nextCall();
    const socket = new WasmClient().websocket(server.url('/close-after-open'), { reconnect: { initialDelayMs: 1 }, onReconnect });
    assert.deepEqual(await socket.closed, { code: 4001, reason: 'done', wasClean: true });
    assert.equal(onReconnect.calls.length, 0);
  });

  it('resets the attempt count once a connection opens', async () => {
    const onOpen = nextCall();
    const onReconnect = nextCall();
    const socket = new WasmClient().websocket(server.url('/drop-after-open'), { reconnect: { maxRetries: 1, initialDelayMs: 1 }, onOpen, onReconnect });
    while (onOpen.calls.length < 3) await onOpen.next();
    // Each drop is the first failure since the last open, so maxRetries: 1 never runs out
    assert.ok(onReconnect.calls.length >= 2);
    assert.ok(onReconnect.calls.every((info) => info.attempt === 1));
    socket.close();
    await socket.closed;
  });

  it('gives up after maxRetries failed attempts in a row', async () => {
    const closedServer = await startServer(() => {});
    const url = closedServer.url('/').replace('http', 'ws');
    await closedServer.close();
    const onReconnect = nextCall();
    const onError = nextCall();
    const socket = new WasmClient().websocket(url, { reconnect: { maxRetries: 2, initialDelayMs: 1 }, onReconnect, onError });
    const error = await rejection(socket.opened);
    assert.equal(error.kind, 'NetworkError');
    assert.deepEqual(onReconnect.calls.map((info) => info.attempt), [1, 2]);
    assert.equal(onError.calls.length, 3);
    assert.equal((await socket.closed).wasClean, false);
  });

  it('rejects opened when the handshake is refused', async () => {
    const socket = new WasmClient().websocket(server.url('/reject'));
    const error = await rejection(socket.opened);
    assert.equal(error.kind, 'NetworkError');
    assert.equal(socket.state, 'closed');
  });

  it('times out a connection attempt', async () => {
    const socket = new WasmClient({ timeoutMs: 5000 }).websocket(server.url('/hang'), { timeoutMs: 50 });
    const error = await rejection(socket.opened);
    assert.equal(error.kind, 'TimeoutError');
    assert.equal(error.timeoutMs, 50);
  });

  it('closing while connecting or reconnecting rejects opened with CancelledError', async () => {
    const connecting = new WasmClient().websocket(server.url('/hang'));
    connecting.close(4000, 'never mind');
    assert.equal((await rejection(connecting.opened)).kind, 'CancelledError');
    assert.deepEqual(await connecting.closed, { code: 4000, reason: 'never mind', wasClean: false });

    const reconnecting = new WasmClient().websocket(server.url('/reject'), {
      reconnect: { initialDelayMs: 10_000 },
      onReconnect: () => reconnecting.close(),
    });
    assert.equal((await rejection(reconnecting.opened)).kind, 'CancelledError');
  });

  it('closes when the signal aborts', async () => {
    const aborted = new WasmClient().websocket(server.url('/'), { signal: AbortSignal.abort() });
    assert.equal((await rejection(aborted.opened)).kind, 'CancelledError');
    assert.equal(aborted.state, 'closed');

    const controller = new AbortController();
    const socket = new WasmClient().websocket(server.url('/'), { signal: controller.signal });
    await socket.opened;
    controller.abort();
    assert.equal((await socket.closed).code, 1000);
  });

  it('keeps an unreferenced connection alive while it is open', async () => {
    const onMessage = nextCall();
    const greeting = onMessage.next();
    new WasmClient().websocket(server.url('/greet'), { onMessage, onOpen: () => globalThis.gc?.() });
    assert.equal(await greeting, 'hello');
    await sleep(10);
    peers.at(-1).close();
  });

  describe('allowPrivateNetwork: false (SSRF)', () => {
    const guarded = (options = {}) => new WasmClient({ allowPrivateNetwork: false, timeoutMs: 2000, ...options });
    const blocked = (error) => error.kind === 'NetworkError' && /^Network error: Blocked: /.test(error.message);

    // Not on fetch's list of blocked ports (9 is), so connections get as far as DNS
    const PORT = 59999;

    /** Run `fn` with dns.lookup answering `answer(hostname)` for hosts ending in .test; resolves to the hosts looked up */
    async function withDns(answer, fn) {
      const lookup = dns.lookup;
      const looked = [];
      dns.lookup = (hostname, options, callback) => {
        if (!hostname.endsWith('.test')) return lookup(hostname, options, callback);
        looked.push(hostname);
        const address = answer(hostname);
        const family = net.isIP(address);
        return options?.all ? callback(null, [{ address, family }]) : callback(null, address, family);
      };
      try {
        await fn();
      } finally {
        dns.lookup = lookup;
      }
      return looked;
    }

    it('blocks private and reserved IP addresses before connecting', () => {
      const before = server.handshakes.length;
      for (const host of ['127.0.0.1', '[::1]', '169.254.169.254', '[::ffff:127.0.0.1]', '[::ffff:a9fe:a9fe]', '10.0.0.1', '0.0.0.0', '[fd00::1]']) {
        assert.throws(() => guarded().websocket(`ws://${host}:${server.port}/`), blocked, host);
      }
      assert.equal(server.handshakes.length, before, 'no handshake reached the server');
    });

    it('checks host names when connecting, and says why one was blocked', async () => {
      const before = server.handshakes.length;
      const socket = guarded().websocket(`ws://localhost:${server.port}/`);
      const error = await rejection(socket.opened);
      assert.ok(blocked(error), error.message);
      assert.match(error.message, /localhost is or resolves to (127\.0\.0\.1|::1)/);
      assert.equal(server.handshakes.length, before);
    });

    it('checks every reconnection again (DNS rebinding)', async () => {
      // public first (it fails some other way: nothing listens there), then private
      let lookups = 0;
      const looked = await withDns(() => (lookups++ === 0 ? '1.1.1.1' : '127.0.0.1'), async () => {
        const errors = [];
        const socket = guarded({ timeoutMs: 300 }).websocket(`ws://rebind.test:${PORT}/`, {
          reconnect: { maxRetries: 1, initialDelayMs: 10 },
          onError: (error) => errors.push(error),
        });
        await socket.closed;
        assert.equal(errors.length, 2);
        assert.ok(!blocked(errors[0]), `the public address wasn't blocked: ${errors[0].message}`);
        assert.ok(blocked(errors[1]), `the private address was: ${errors[1].message}`);
        assert.match(errors[1].message, /rebind\.test is or resolves to 127\.0\.0\.1/);
      });
      assert.deepEqual(looked, ['rebind.test', 'rebind.test'], 'each attempt resolved the name');
    });

    it('lets public addresses through, and can be overridden per connection', async () => {
      const looked = await withDns(() => '1.1.1.1', async () => {
        const error = await rejection(guarded({ timeoutMs: 300 }).websocket(`ws://public.test:${PORT}/`).opened);
        assert.ok(!blocked(error), error.message);
      });
      assert.deepEqual(looked, ['public.test'], 'it was resolved and let through');
      const allowed = guarded().websocket(server.url('/'), { allowPrivateNetwork: true });
      await allowed.opened;
      allowed.close();
      await allowed.closed;
      assert.throws(() => new WasmClient().websocket(server.url('/'), { allowPrivateNetwork: false }), blocked);
    });

    it("can't be combined with a dispatcher, and fails closed with another global dispatcher", async () => {
      assert.throws(
        () => guarded().websocket('ws://example.com/', { dispatcher: new ProxyAgent('http://127.0.0.1:9') }),
        (e) => e.kind === 'InvalidInputError' && e.parameter === 'dispatcher',
      );
      assert.throws(() => guarded().websocket('ws://example.com/', { allowPrivateNetwork: 'no' }), (e) => e.parameter === 'allowPrivateNetwork');
      // A ProxyAgent installed as undici's global dispatcher, here after the checked one was made…
      const key = Symbol.for('undici.globalDispatcher.1');
      const installed = globalThis[key];
      globalThis[key] = new ProxyAgent('http://127.0.0.1:9');
      try {
        assert.throws(() => guarded().websocket('ws://example.com/'), (e) => e.kind === 'InvalidInputError' && e.parameter === 'allowPrivateNetwork' && /another undici global dispatcher/.test(e.message));
      } finally {
        globalThis[key] = installed;
      }
      // …and in a fresh process, before any checked connection
      const script = `import { setGlobalDispatcher, ProxyAgent } from 'undici';
        const { WasmClient } = await import(${JSON.stringify(new URL('../../pkg/node.js', import.meta.url).href)});
        setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:9'));
        try { new WasmClient({ allowPrivateNetwork: false }).websocket('ws://example.com/'); console.log('connected unchecked'); }
        catch (e) { console.log(e.kind, e.parameter, e.message); }`;
      // Node.js 20 needs its flag in the child too
      const flags = process.execArgv.filter((flag) => flag === '--experimental-websocket');
      const { stdout } = await promisify(execFile)(process.execPath, [...flags, '--input-type=module', '-e', script], { cwd: new URL('.', import.meta.url) });
      assert.match(stdout, /^InvalidInputError allowPrivateNetwork .*another undici global dispatcher is installed/);
    });
  });

  it('rejects invalid options and arguments', async () => {
    const client = new WasmClient();
    const invalid = (fn, parameter) => assert.throws(fn, (error) => error.kind === 'InvalidInputError' && error.parameter === parameter);
    invalid(() => client.websocket('ftp://example.com/'), 'url');
    invalid(() => client.websocket('/relative'), 'url');
    invalid(() => client.websocket(server.url(), { protocols: [1] }), 'protocols');
    invalid(() => client.websocket(server.url(), { protocols: 1 }), 'protocols');
    invalid(() => client.websocket(server.url(), { reconnect: 'yes' }), 'reconnect');
    invalid(() => client.websocket(server.url(), { reconnect: -1 }), 'reconnect');
    invalid(() => client.websocket(server.url(), { reconnect: { multiplier: 0.5 } }), 'reconnect.multiplier');
    invalid(() => client.websocket(server.url(), { reconnect: { maxRetries: 1.5 } }), 'reconnect.maxRetries');
    invalid(() => client.websocket(server.url(), { reconnect: { initialDelayMs: -1 } }), 'reconnect.initialDelayMs');
    invalid(() => client.websocket(server.url(), { reconnect: { maxDelayMs: 'x' } }), 'reconnect.maxDelayMs');
    invalid(() => client.websocket(server.url(), { messageType: 'xml' }), 'messageType');
    invalid(() => client.websocket(server.url(), { timeoutMs: -1 }), 'timeoutMs');
    invalid(() => client.websocket(server.url(), { onMessage: 'x' }), 'onMessage');
    invalid(() => client.websocket(server.url(), { signal: {} }), 'signal');
    invalid(() => client.websocket(server.url(), { dispatcher: 'http://proxy' }), 'dispatcher');
    for (const value of [0, -1, 1.5, '2']) {
      invalid(() => client.websocket(server.url(), { maxQueuedMessages: value }), 'maxQueuedMessages');
      invalid(() => client.websocket(server.url(), { maxQueuedBytes: value }), 'maxQueuedBytes');
    }
    // allowAbsoluteUrls: an absolute URL can't replace the base URL
    const guarded = new WasmClient({ baseUrl: server.httpUrl('/v1'), allowAbsoluteUrls: false });
    invalid(() => guarded.websocket('ws://other.example/'), 'url');
    invalid(() => client.websocket(server.url(), { allowAbsoluteUrls: 'no' }), 'allowAbsoluteUrls');
    const allowed = guarded.websocket(server.url('/allowed'), { allowAbsoluteUrls: true });
    allowed.close();
    await allowed.closed;

    const socket = client.websocket(server.url(), { reconnect: Infinity });
    await socket.opened;
    invalid(() => socket.send({ a: 1 }), 'data');
    invalid(() => socket.sendJson(undefined), 'value');
    invalid(() => socket.close(1001), 'code');
    invalid(() => socket.close(1000, 'x'.repeat(124)), 'reason');
    socket.close();
    await socket.closed;

    // false and 0 turn reconnecting off
    for (const reconnect of [false, 0, true, { maxRetries: Infinity }]) {
      const s = client.websocket(server.url(), { reconnect });
      s.close();
      await s.closed;
    }
  });
});
