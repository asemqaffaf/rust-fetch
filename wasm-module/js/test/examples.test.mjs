// The runnable examples in examples/ (#73), run against local servers so they can't rot.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { json, rejection, startServer, startWebSocketServer } from './helpers.mjs';

// The examples import 'rust-fetch' as an application would; point it at the package built in this repository
const examples = fileURLToPath(new URL('../../../examples/', import.meta.url));
const installed = `${examples}node_modules/rust-fetch`;
if (!existsSync(installed)) {
  mkdirSync(`${examples}node_modules`, { recursive: true });
  symlinkSync(fileURLToPath(new URL('../../pkg/', import.meta.url)), installed, 'dir');
}
const load = (name) => import(pathToFileURL(`${examples}${name}/index.mjs`).href);

describe('node-client', () => {
  let server;
  const seen = [];
  let flaky = 0;
  before(async () => {
    server = await startServer((req, res, ctx) => {
      seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, key: req.headers['idempotency-key'] });
      if (req.url === '/users/404') return json(res, { error: 'not found' }, { status: 404 });
      if (req.url === '/users/1' && flaky++ === 0) return json(res, {}, { status: 503 }); // the first attempt fails: retried
      if (req.method === 'POST') return json(res, { id: 2, name: 'Ada' }, { status: 201 });
      json(res, { id: 1, name: 'Grace' });
    });
  });
  after(() => server.close());

  it('retries, authenticates, branches on typed errors and keeps stats', async () => {
    const { run } = await load('node-client');
    const lines = [];
    const results = await run({ baseUrl: server.url('').replace(/\/$/, ''), token: 'abc', log: (line) => lines.push(line) });
    assert.deepEqual(results.user, { id: 1, name: 'Grace' });
    assert.deepEqual(results.created, { id: 2, name: 'Ada' });
    assert.equal(results.notFound, true);
    assert.ok(seen.every((r) => r.authorization === 'Bearer abc'));
    assert.ok(seen.find((r) => r.method === 'POST').key, 'the POST carries an idempotency key');
    assert.equal(seen.filter((r) => r.url === '/users/1').length, 2, 'the 503 was retried');
    assert.ok(lines.some((line) => line.startsWith('-> GET')) && lines.some((line) => line === '<- 200'));
    assert.ok(results.stats.started >= 3);
  });
});

describe('llm-streaming', () => {
  let server;
  before(async () => {
    server = await startServer(async (req, res) => {
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const word of ['Hel', 'lo', '!']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      for (const word of ['Hi', ' there']) res.write(`${JSON.stringify({ response: word, done: false })}\n`);
      res.end(`${JSON.stringify({ response: '', done: true })}\n`);
    });
  });
  after(() => server.close());

  it('streams Server-Sent Events and NDJSON', async () => {
    const { run } = await load('llm-streaming');
    assert.deepEqual(await run({ baseUrl: server.url('').replace(/\/$/, '') }), { sse: 'Hello!', ndjson: 'Hi there' });
  });
});

describe('websocket-chat', { skip: typeof WebSocket === 'undefined' && 'needs a global WebSocket (Node.js 22+)' }, () => {
  let chat;
  before(async () => {
    let connections = 0;
    chat = await startWebSocketServer((peer) => {
      connections++;
      if (connections === 1) setTimeout(() => peer.drop(), 30); // the first connection drops: the client reconnects
      else for (const n of [1, 2]) peer.send(JSON.stringify({ n }));
    });
  });
  after(() => chat.close());

  it('reconnects after a drop and keeps receiving', async () => {
    const { run } = await load('websocket-chat');
    const results = await run({ url: chat.url('/room'), expected: 2, log: () => {} });
    assert.deepEqual(results.received, [{ n: 1 }, { n: 2 }]);
    assert.ok(results.reconnects >= 1);
    assert.equal(results.closeCode, 1000);
  });
});

describe('websocket-chat: request and response', { skip: typeof WebSocket === 'undefined' && 'needs a global WebSocket (Node.js 22+)' }, () => {
  let rpc;
  let connections = 0;
  before(async () => {
    rpc = await startWebSocketServer((peer, req) => {
      connections++;
      const path = new URL(req.url, 'http://x').pathname;
      peer.onmessage = (raw) => {
        const message = JSON.parse(raw);
        if (path === '/silent') return; // never answers
        if (path === '/drop') return setTimeout(() => peer.drop(), 10); // takes the request, then the connection goes
        if (message.type === 'push') peer.send(JSON.stringify({ type: 'news' })); // a message that is not a reply
        peer.send(JSON.stringify({ id: message.id, echo: message.type }));
      };
    });
  });
  after(() => rpc.close());

  it('resolves each request with the reply carrying its id, in any order, and passes pushes through', async () => {
    const { requestSocket } = await import(pathToFileURL(`${examples}websocket-chat/request.mjs`).href);
    const { default: init, WasmClient } = await import('../../pkg/node.js');
    await init();
    const pushes = [];
    const { socket, request } = requestSocket(new WasmClient(), rpc.url('/'), { onMessage: (m) => pushes.push(m) });
    await socket.opened;
    const replies = await Promise.all([request({ type: 'a' }), request({ type: 'push' }), request({ type: 'c' })]);
    assert.deepEqual(replies.map((r) => r.echo), ['a', 'push', 'c']);
    assert.deepEqual(pushes, [{ type: 'news' }]);
    socket.close();
    await socket.closed;
  });

  it('times out, cancels, bounds pending requests, and fails them when the connection drops or closes', async () => {
    const { requestSocket } = await import(pathToFileURL(`${examples}websocket-chat/request.mjs`).href);
    const { default: init, WasmClient } = await import('../../pkg/node.js');
    await init();
    const silent = requestSocket(new WasmClient(), rpc.url('/silent'), { timeoutMs: 60, maxPending: 2 });
    await silent.socket.opened;
    assert.equal((await rejection(silent.request({ type: 'x' }))).kind, 'TimeoutError');
    const controller = new AbortController();
    const cancelled = rejection(silent.request({ type: 'x' }, { signal: controller.signal, timeoutMs: 5000 }));
    controller.abort();
    assert.equal((await cancelled).kind, 'CancelledError');
    const first = rejection(silent.request({ type: 'x' }, { timeoutMs: 5000 }));
    const second = rejection(silent.request({ type: 'x' }, { timeoutMs: 5000 }));
    assert.match((await rejection(silent.request({ type: 'x' }))).message, /More than 2 requests/);
    assert.equal(silent.pending, 2);
    silent.socket.close();
    assert.deepEqual([(await first).kind, (await second).kind], ['CancelledError', 'CancelledError']);
    assert.equal(silent.pending, 0);

    const dropping = requestSocket(new WasmClient(), rpc.url('/drop'), { reconnect: { initialDelayMs: 20 } });
    await dropping.socket.opened;
    const lost = await rejection(dropping.request({ type: 'x' }, { timeoutMs: 5000 }));
    assert.equal(lost.kind, 'NetworkError');
    assert.match(lost.message, /may have been delivered/);
    dropping.socket.close();
  });
});
