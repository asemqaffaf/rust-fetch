// rust-fetch on Bun and Deno (#48): the built Node.js entry against local servers.
// Run with `bun run smoke.mjs` or `deno run --allow-all smoke.mjs` after `npm run build`.
// It also runs under Node.js, which keeps the expectations honest.
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import init, { WasmClient, isHttpError } from '../../../pkg/node.js';
import { startWebSocketServer } from '../helpers.mjs';

const runtime = globalThis.Bun ? `bun ${Bun.version}` : globalThis.Deno ? `deno ${Deno.version.deno}` : `node ${process.versions.node}`;
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}\n${error?.stack ?? error}`);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    switch (url.pathname) {
      case '/flaky':
        server.flaky = (server.flaky ?? 0) + 1;
        if (server.flaky < 3) return res.writeHead(503, { 'retry-after': '0' }).end();
        break;
      case '/missing': return res.writeHead(404, { 'content-type': 'text/plain' }).end('no such thing');
      case '/slow': return setTimeout(() => res.writeHead(200).end('late'), 1500);
      case '/sse':
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const n of [1, 2, 3]) res.write(`data: ${JSON.stringify({ n })}\n\n`);
        return res.end('data: [DONE]\n\n');
      case '/ndjson':
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        return res.end('{"a":1}\n{"a":2}\n');
      case '/gzip':
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
        return res.end(zlib.gzipSync(JSON.stringify({ ok: true, n: 1 })));
      default:
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ method: req.method, path: url.pathname, query: url.search, length: body.length, echo: body.length && String(req.headers['content-type']).includes('json') ? JSON.parse(body.toString()) : null, auth: req.headers.authorization ?? null }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

await init();
console.log(`rust-fetch on ${runtime}`);
const client = () => new WasmClient({ baseUrl: base, retries: 0 });

await check('GET returns parsed JSON', async () => {
  const response = await client().get('/a?x=1');
  assert.deepEqual([response.status, response.body.path, response.body.query], [200, '/a', '?x=1']);
});
await check('POST sends a JSON body', async () => {
  const response = await client().post('/b', { body: { n: 1 } });
  assert.deepEqual(response.body.echo, { n: 1 });
});
await check('a 404 rejects with an HttpError carrying the body', async () => {
  const error = await client().get('/missing').then(() => assert.fail('expected a rejection'), (e) => e);
  assert.ok(isHttpError(error));
  assert.deepEqual([error.status, error.body], [404, 'no such thing']);
});
await check('retries a 503 and succeeds', async () => {
  const response = await new WasmClient({ baseUrl: base, retries: { maxRetries: 3, initialDelayMs: 1 } }).get('/flaky');
  assert.equal(response.status, 200);
});
await check('a network failure is a NetworkError', async () => {
  const error = await new WasmClient({ retries: 0 }).get('http://127.0.0.1:1/').then(() => assert.fail('expected a rejection'), (e) => e);
  assert.equal(error.kind, 'NetworkError');
});
await check('a slow response is a TimeoutError', async () => {
  const error = await client().get('/slow', { timeoutMs: 100 }).then(() => assert.fail('expected a rejection'), (e) => e);
  assert.equal(error.kind, 'TimeoutError');
});
await check('an AbortSignal cancels, with its reason', async () => {
  const controller = new AbortController();
  const pending = client().get('/slow', { signal: controller.signal });
  setTimeout(() => controller.abort('stop'), 30);
  const error = await pending.then(() => assert.fail('expected a rejection'), (e) => e);
  assert.deepEqual([error.kind, error.reason], ['CancelledError', 'stop']);
});
await check('decodes a gzip response', async () => {
  const response = await client().get('/gzip');
  assert.deepEqual(response.body, { ok: true, n: 1 });
});
await check('streams Server-Sent Events', async () => {
  const seen = [];
  for await (const event of client().events('/sse', { messageType: 'json', reconnect: false })) seen.push(event.data.n);
  assert.deepEqual(seen, [1, 2, 3]);
});
await check('streams NDJSON', async () => {
  const response = await client().get('/ndjson', { responseType: 'ndjson' });
  const seen = [];
  for await (const line of response.body) seen.push(line.a);
  assert.deepEqual(seen, [1, 2]);
});
await check('reports upload progress', async () => {
  let last = 0;
  await client().post('/up', { body: new Uint8Array(100_000), headers: { 'content-type': 'application/octet-stream' }, onUploadProgress: ({ loaded }) => { last = loaded; } });
  assert.ok(last > 0, `loaded ${last}`);
});
await check('auth sends the bearer token to its own origin only', async () => {
  const response = await new WasmClient({ baseUrl: base, retries: 0, auth: { bearer: 'tok' } }).get('/who');
  assert.equal(response.body.auth, 'Bearer tok');
});
await check('a WebSocket connects, exchanges messages and closes', async () => {
  const ws = await startWebSocketServer((peer) => { peer.onmessage = (message) => peer.send(`echo:${message}`); });
  try {
    const received = [];
    const socket = new WasmClient().websocket(ws.url('/'), { onMessage: (m) => received.push(m) });
    await socket.opened;
    socket.send('hi');
    for (let i = 0; i < 100 && !received.length; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    socket.close(1000);
    await socket.closed;
    assert.deepEqual(received, ['echo:hi']);
  } finally {
    await ws.close();
  }
});

server.closeAllConnections?.();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed on ${runtime}`);
process.exit(failed.length ? 1 : 0);
