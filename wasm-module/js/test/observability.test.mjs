import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { json, rejection, sleep, startServer } from './helpers.mjs';
const browser = process.env.OBSERVABILITY_BROWSER === '1';
const rf = await import(browser ? '../../pkg/rust_fetch.js' : '../../pkg/node.js');
if (browser) rf.initSync({ module: readFileSync(new URL('../../pkg/rust_fetch_bg.wasm', import.meta.url)) });
const { WasmClient } = rf;
let server, other;
before(async () => {
  other = await startServer((req, res) => json(res, { headers: req.headers }));
  server = await startServer(async (req, res, ctx) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/slow') { await sleep(20); res.setHeader('content-type', 'application/json'); res.write('{"ok":'); await sleep(30); res.end('true}'); }
    else if (path === '/retry' && !req.headers['x-retried'] && ctx.count % 2 === 0) { res.writeHead(503); res.end('secret-response'); }
    else if (path === '/reset') { req.socket.destroy(); }
    else if (path === '/error') { res.writeHead(503); res.end('secret-response'); }
    else if (path === '/retry-after') { res.writeHead(429, { 'retry-after': '1' }); res.end('limited'); }
    else if (path === '/redirect') { res.writeHead(302, { location: other.url('/?token=redirect-secret') }); res.end(); }
    else if (path === '/stream') { res.setHeader('content-type', 'text/plain'); res.write('first'); await sleep(30); res.end('last'); }
    else if (path === '/stall') { res.writeHead(200, { 'content-type': 'text/plain' }); res.write('one'); }
    else if (path === '/sse-error') { res.writeHead(503); res.end('failed'); }
    else json(res, { headers: req.headers, method: req.method });
  });
});
after(async () => { await server?.close(); await other?.close(); });

describe('observability (' + (browser ? 'fetch' : process.env.RUST_FETCH_NATIVE === '0' ? 'node:http' : 'native') + ')', () => {
  it('keeps timings opt-in and adds exact context to ordinary errors', async () => {
    const client = new WasmClient({ baseUrl: server.url('/base'), retries: { maxRetries: 2, initialDelayMs: 1, jitter: false } });
    assert.equal((await client.get('/ok')).timings, undefined);
    const error = await rejection(client.get(server.url('/error?token=private')));
    assert.equal(error.kind, 'HttpError'); assert.equal(error.method, 'GET');
    assert.equal(error.url, server.url('/error?token=private')); assert.equal(error.attempts, 3);
    const invalid = await rejection(client.get('bad://invalid'));
    assert.equal(invalid.attempts, 0); assert.equal(invalid.method, 'GET');
  });
  it('records headers separately from body completion and preserves reuse details', async () => {
    const ends = [];
    const client = new WasmClient({ timings: true, onRequestEnd: (entry) => ends.push(entry) });
    const response = await client.get(server.url('/slow'));
    const first = response.timings.attempts[0];
    assert.equal(response.timings.attempts.length, 1);
    assert.equal(first.status, 200); assert.ok(first.ttfbMs >= 10, JSON.stringify(first));
    assert.ok(first.totalMs >= first.ttfbMs + 15, JSON.stringify(first));
    assert.ok(response.timings.totalMs >= first.totalMs);
    await client.get(server.url('/slow'));
    assert.equal(ends.length, 2);
    if (!browser) assert.equal(ends[1].timings.attempts[0].connectionReused, true);
  });
  it('retains network causes and closes failed attempts', async () => {
    const client = new WasmClient({ timings: true, metrics: true });
    const error = await rejection(client.get(server.url('/reset')));
    assert.equal(error.kind, 'NetworkError');
    assert.equal(error.attempts, 1);
    assert.ok(error.cause instanceof Error);
    assert.equal(client.stats().requests.active, 0);
  });
  it('retains network causes without enabling diagnostics, including SSE', async () => {
    const client = new WasmClient();
    const error = await rejection(client.get(server.url('/reset')));
    assert.equal(error.kind, 'NetworkError');
    assert.ok(error.cause instanceof Error);
    assert.equal(error.timings, undefined);
    const events = client.events(server.url('/reset'), { reconnect: false });
    const connectionError = await rejection(events.opened);
    assert.equal(connectionError.kind, 'NetworkError');
    assert.ok(connectionError.cause instanceof Error);
  });
  it('does not replace frozen interceptor errors when adding diagnostics', async () => {
    const ends = [];
    const client = new WasmClient({ metrics: true, timings: true, onRequestEnd: (entry) => ends.push(entry) });
    const error = Object.freeze(new Error('application failure'));
    client.addRequestInterceptor(() => { throw error; });
    assert.equal(await rejection(client.get(server.url())), error);
    assert.equal(client.stats().requests.failed, 1);
    assert.equal(ends.length, 1);
  });
  it('does not attach a previous attempt cause to a later HTTP failure', async () => {
    let attempts = 0;
    const local = await startServer((req, res) => {
      if (++attempts % 2 === 1) req.socket.destroy();
      else { res.writeHead(503); res.end('unavailable'); }
    });
    try {
      for (const timings of [false, true]) {
        const client = new WasmClient({ timings, retries: { maxRetries: 1, initialDelayMs: 1, jitter: false } });
        const error = await rejection(client.get(local.url()));
        assert.equal(error.kind, 'HttpError');
        assert.equal(error.attempts, 2);
        assert.equal(error.cause, undefined);
      }
    } finally { await local.close(); }
  });
  it('does not retain an earlier redirect destination when the next attempt fails before headers', async () => {
    let starts = 0;
    const local = await startServer((req, res) => {
      if (req.url === '/start') {
        if (++starts === 1) { res.writeHead(302, { location: '/unavailable' }); res.end(); }
        else req.socket.destroy();
      } else { res.writeHead(503); res.end('unavailable'); }
    });
    try {
      const client = new WasmClient({ retries: { maxRetries: 1, initialDelayMs: 1, jitter: false } });
      const error = await rejection(client.get(local.url('/start')));
      assert.equal(error.kind, 'NetworkError');
      assert.equal(error.attempts, 2);
      assert.equal(error.url, local.url('/start'));
    } finally { await local.close(); }
  });
  it('keeps intercepted validation errors tied to the rewritten request', async () => {
    const client = new WasmClient();
    client.addRequestInterceptor((request) => { request.method = 'PATCH'; request.url = 'bad://rewritten'; });
    const error = await rejection(client.get(server.url()));
    assert.equal(error.kind, 'InvalidInputError');
    assert.equal(error.method, 'PATCH');
    assert.equal(error.url, 'bad://rewritten');
    assert.equal(error.attempts, 0);
  });
  it('counts transport and agent queues without retaining completed requests', { skip: browser }, async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const local = await startServer(async (req, res) => { await gate; res.end('ok'); });
    const client = new WasmClient({ metrics: true });
    const pending = Promise.all(Array.from({ length: 1100 }, () => client.get(local.url())));
    try {
      let snapshot;
      for (let i = 0; i < 50; i++) {
        await sleep(2); snapshot = client.stats();
        if (snapshot.pools.queued > 0) break;
      }
      assert.ok(snapshot.pools.queued > 0);
      const pools = [...(snapshot.pools.native ?? []), ...snapshot.pools.http];
      assert.ok(pools.some((pool) => pool.queued > 0));
      release(); await pending;
      assert.equal(client.stats().requests.active, 0);
      assert.equal(client.stats().pools.queued, 0);
    } finally { release(); await pending; await local.close(); }
  });
  it('preserves primitive interceptor rejections while observing failures', async () => {
    const client = new WasmClient({ metrics: true, timings: true });
    client.addRequestInterceptor(() => { throw 'primitive'; });
    assert.equal(await rejection(client.get(server.url())), 'primitive');
    assert.equal(client.stats().requests.failed, 1);
  });
  it('measures FIFO admission and retry delays from the Rust policy loop', async () => {
    const client = new WasmClient({ timings: true, maxConcurrent: 1, retries: { maxRetries: 1, initialDelayMs: 10, maxDelayMs: 10, jitter: false } });
    const [a, b] = await Promise.all([client.get(server.url('/slow')), client.get(server.url('/slow'))]);
    assert.ok(b.timings.queuedMs >= 20, JSON.stringify(b.timings));
    const error = await rejection(client.get(server.url('/error')));
    assert.equal(error.attempts, 2); assert.equal(error.timings.attempts.length, 2);
    assert.ok(error.timings.retryDelayMs >= 5); assert.equal(a.body.ok, true);
  });
  it('redacts URLs, credentials, custom secrets and response bodies in hooks/logs', async () => {
    const entries = [];
    const client = new WasmClient({
      debug: (e) => entries.push(e), onRequestStart: (e) => entries.push(e), onRequestEnd: (e) => entries.push(e),
      sensitiveHeaders: ['x-api-key'], headers: { authorization: 'Bearer auth-secret', cookie: 'cookie-secret', 'x-api-key': 'custom-secret' },
      redactUrl: (url) => url.replace('/error', '/redacted'),
    });
    const error = await rejection(client.get(server.url('/error?token=query-secret')));
    const text = JSON.stringify(entries);
    for (const secret of ['auth-secret', 'cookie-secret', 'custom-secret', 'query-secret', 'secret-response']) assert.ok(!text.includes(secret), text);
    assert.ok(text.includes('[REDACTED]')); assert.ok(text.includes('/redacted'));
    assert.ok(error.url.includes('/redacted')); assert.equal(error.body, 'secret-response');
    assert.equal(entries.filter((e) => e.type === 'requestEnd').length, 2);
  });
  it('logs the retry reason, status and server delay independently of the capped wait', async () => {
    const entries = [];
    const client = new WasmClient({ debug: (entry) => entries.push(entry), retries: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 5, jitter: false } });
    const error = await rejection(client.get(server.url('/retry-after')));
    assert.equal(error.attempts, 2);
    const retry = entries.find((entry) => entry.type === 'retry');
    assert.equal(retry.reason, 'HttpError');
    assert.equal(retry.status, 429);
    assert.equal(retry.retryAfterMs, 1000);
    assert.equal(retry.delayMs, 5);
  });
  it('isolates failures thrown or rejected by lifecycle hooks', async () => {
    const client = new WasmClient({ onRequestStart: async () => { throw Error('ignored'); }, onRequestEnd: () => { throw Error('ignored'); } });
    assert.equal((await client.get(server.url())).status, 200);
  });
  it('propagates both trace headers only to allowlisted resolved destinations', async () => {
    const parent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    let calls = 0;
    const client = new WasmClient({ propagateTrace: true, traceOrigins: [server.base], traceContext: () => { calls++; return { traceparent: parent, tracestate: 'vendor=value' }; } });
    const allowed = await client.get(server.url());
    assert.equal(allowed.body.headers.traceparent, parent); assert.equal(allowed.body.headers.tracestate, 'vendor=value');
    assert.equal(calls, 1, 'resolve trace context once per logical request');
    const denied = await client.get(other.url());
    assert.equal(denied.body.headers.traceparent, undefined);
    assert.equal(calls, 1, 'do not call the provider for other origins');
    const before = other.requests.length;
    if (browser) await rejection(client.get(server.url('/redirect')));
    else assert.equal((await client.get(server.url('/redirect'))).body.headers.traceparent, undefined);
    if (browser) assert.equal(other.requests.length, before, 'browser tracing must refuse automatic redirects');
    client.addRequestInterceptor((request) => { request.url = other.url(); });
    assert.equal((await client.get(server.url())).body.headers.traceparent, undefined);
  });
  it('rejects malformed trace context and missing destination controls', async () => {
    assert.throws(() => new WasmClient({ propagateTrace: true }), (e) => e.parameter === 'propagateTrace');
    for (const context of [{ traceparent: '00-' + '0'.repeat(32) + '-' + '1'.repeat(16) + '-01' }, { traceparent: 'injected\r\nsecret' }, { traceparent: '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01', tracestate: 'a=x,a=y' }]) {
      const client = new WasmClient({ propagateTrace: true, traceOrigins: [server.base], traceContext: () => context });
      const error = await rejection(client.get(server.url()));
      assert.equal(error.kind, 'InvalidInputError'); assert.equal(error.attempts, 0);
    }
    for (const options of [{ debug: 'yes' }, { onRequestEnd: 5 }, { traceOrigins: ['https://user:secret@example.test'] }, { metrics: 'yes' }]) assert.throws(() => new WasmClient(options), (e) => e.kind === 'InvalidInputError');
  });
  it('finishes streamed lifecycle and metrics at EOF or cancellation', async () => {
    const ends = [];
    const client = new WasmClient({ metrics: true, timings: true, onRequestEnd: (e) => ends.push(e) });
    const response = await client.get(server.url('/stream'), { responseType: 'stream' });
    assert.equal(client.stats().requests.active, 1); assert.equal(ends.length, 0);
    assert.equal(await new Response(response.body).text(), 'firstlast');
    assert.equal(client.stats().requests.active, 0); assert.equal(ends.length, 1);
    const stalled = await client.get(server.url('/stall'), { responseType: 'stream' });
    await stalled.body.cancel(); assert.equal(client.stats().requests.active, 0); assert.equal(ends.length, 2);
  });
  it('keeps detached, bounded count/latency snapshots and balanced pool totals', async () => {
    const client = new WasmClient({ metrics: true });
    await Promise.all(Array.from({ length: 10 }, () => client.get(server.url())));
    await rejection(client.get(server.url('/error')));
    const stats = client.stats();
    assert.deepEqual(stats.requests, { started: 11, completed: 11, failed: 1, active: 0 });
    assert.equal(stats.attempts, 11); assert.equal(stats.latency.count, 11);
    assert.ok(stats.latency.p95Ms >= stats.latency.p50Ms);
    stats.requests.completed = -1; assert.equal(client.stats().requests.completed, 11);
    if (!browser) for (const pool of [...(stats.pools.native ?? []), ...stats.pools.http]) assert.equal(pool.opened, pool.idle + pool.busy + pool.closed);
    assert.equal(new WasmClient().stats().latency.count, 0);
  });
  it('adds connection context to SSE and WebSocket failures', async () => {
    const client = new WasmClient({ retries: 1 });
    const events = client.events(server.url('/sse-error'), { reconnect: false });
    const error = await rejection(events.opened);
    assert.equal(error.method, 'GET'); assert.equal(error.url, server.url('/sse-error')); assert.equal(error.attempts, 2);
    if (!browser && typeof WebSocket === 'function') {
      assert.throws(() => client.websocket('ws://127.0.0.1:59999/', { allowPrivateNetwork: false }), (e) => e.method === 'GET' && e.url.startsWith('ws://'));
    }
  });
  it('adds the resolved WebSocket URL to synchronous send and close errors', { skip: browser || typeof WebSocket !== 'function' }, async () => {
    const client = new WasmClient({ baseUrl: server.base });
    const socket = client.websocket('/queued', { maxQueuedMessages: 1, params: { token: 'private' } });
    try {
      socket.send('filled');
      for (const send of [() => socket.send('one'), () => socket.sendJson({ one: 1 }), () => socket.close(2000)]) {
        assert.throws(send, (error) => {
          assert.equal(error.method, 'GET');
          assert.equal(error.url, server.url('/queued?token=private').replace('http:', 'ws:'));
          assert.equal(error.attempts, 1);
          return true;
        });
      }
    } finally { socket.opened.catch(() => {}); socket.close(); await socket.closed; }
  });
});
it('snapshots diagnostic defaults with the same lifetime as core configuration', async () => {
  const entries = [];
  const options = { baseUrl: server.base, headers: { 'x-snapshot': 'before' }, debug: (e) => entries.push(e) };
  const client = new WasmClient(options);
  options.baseUrl = other.base; options.headers['x-snapshot'] = 'after';
  const response = await client.get('/snapshot');
  assert.equal(response.body.headers['x-snapshot'], 'before');
  assert.equal(entries.find((e) => e.type === 'request').headers['x-snapshot'], 'before');
  assert.ok(entries.find((e) => e.type === 'request').url.startsWith(server.base));
});
