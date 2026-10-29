// WasmClient.events(): Server-Sent Events against a local server, in Node.js.
// Run `npm run build` first.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WasmClient } from '../../pkg/node.js';
import { rejection, sleep, startServer } from './helpers.mjs';

let server;
const connections = new Map(); // per test id: requests seen
// /v1/flood: events written so far, and whether the client closed the stream
const flood = { written: 0, closed: false };
const FLOOD_EVENTS = 20_000; // 1 KB each

function sse(res, status = 200, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...headers });
}

before(async () => {
  server = await startServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const id = url.searchParams.get('id') ?? '';
    const seen = connections.get(id) ?? [];
    seen.push({ method: req.method, headers: req.headers, body: req.body.toString() });
    connections.set(id, seen);
    switch (url.pathname) {
      case '/v1/feed':
        sse(res);
        res.write(': comment\n\n');
        res.write('data: first\n\n');
        res.write('event: update\ndata: line 1\ndata: line 2\nid: 7\n\n');
        res.write(Buffer.from('data: Zoë 🦀\n\n').subarray(0, 9));
        await sleep(20);
        res.write(Buffer.from('data: Zoë 🦀\n\n').subarray(9));
        return; // stays open
      case '/v1/flood': {
        sse(res);
        Object.assign(flood, { written: 0, closed: false });
        res.on('close', () => (flood.closed = true));
        const total = Number(url.searchParams.get('n') ?? FLOOD_EVENTS);
        while (flood.written < total && !res.destroyed) {
          const event = `data: ${String(flood.written++).padStart(8, '0')}${'x'.repeat(1008)}\n\n`;
          if (!res.write(event)) await new Promise((resolve) => res.once('drain', resolve).once('close', resolve));
        }
        return res.end();
      }
      case '/v1/event-size': {
        // "ok", then one event of `lines` data lines of `size` bytes each, then "after"
        sse(res);
        res.on('close', () => (flood.closed = true));
        const lines = Number(url.searchParams.get('lines'));
        const line = `data: ${'e'.repeat(Number(url.searchParams.get('size')))}\n`;
        res.write(`data: ok\n\n${line.repeat(lines)}\ndata: after\n\n`);
        return; // stays open: the client has to close it
      }
      case '/v1/long-line': {
        // An event within the limit, then a data line (or a comment) over it
        sse(res);
        res.on('close', () => (flood.closed = true));
        const long = url.searchParams.get('comment') ? `:${'c'.repeat(16)}\n` : `data: ${'d'.repeat(16)}\n\n`;
        res.write(`data: ok\ndata: also ok\n\n${long}data: never\n\n`);
        return; // stays open: the client has to close it
      }
      case '/v1/count': {
        sse(res);
        for (let i = 1; i <= 100 && !res.destroyed; i++) {
          res.write(`data: ${i}\n\n`);
          await sleep(5);
        }
        return res.end();
      }
      case '/v1/llm':
        // A streaming LLM API: POST a JSON body, get JSON chunks, then [DONE]
        sse(res);
        for (const word of ['Hello', ', ', 'world']) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`);
          await sleep(5);
        }
        res.write('data: [DONE]\n\n');
        return res.end();
      case '/v1/resume':
        // First connection: one event, retry 50 ms, then the stream ends.
        // Later connections must send Last-Event-ID.
        sse(res);
        if (seen.length === 1) {
          res.write('retry: 50\nid: 1\ndata: before\n\n');
          return res.end();
        }
        res.write(`id: 2\ndata: after ${req.headers['last-event-id']}\n\n`);
        return;
      case '/v1/no-content':
        res.writeHead(204);
        return res.end();
      case '/v1/html':
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<html></html>');
      case '/v1/status':
        res.writeHead(Number(url.searchParams.get('code')), { 'content-type': 'text/plain' });
        return res.end('nope');
      case '/v1/bad-json':
        sse(res);
        res.write('data: {"ok":1}\n\ndata: not json\n\ndata: {"ok":2}\n\n');
        return res.end();
      default:
        res.writeHead(404);
        return res.end();
    }
  });
});

after(() => server.close());

const client = (options = {}) => new WasmClient({ baseUrl: server.url('/v1'), ...options });

/** Collect events delivered to onEvent until `count` have arrived */
function collector(count) {
  const events = [];
  let done;
  const all = new Promise((resolve) => (done = resolve));
  return {
    events,
    all,
    onEvent: (event) => {
      events.push(event);
      if (events.length === count) done(events);
    },
  };
}

describe('events', () => {
  it('reconnects after idle timeouts and closes at a deadline during backoff', async () => {
    const errors = [];
    const stream = client().events('/feed?id=phase-deadline', { idleTimeoutMs: 100, deadlineMs: 1500, reconnect: { initialDelayMs: 3000, jitter: false }, onError: (e) => errors.push([e.kind, e.phase, e.timeoutMs]) });
    await stream.opened;
    await stream.closed;
    assert.deepEqual(errors, [['TimeoutError', 'idle', 100], ['TimeoutError', 'total', 1500]]);
    assert.equal(connections.get('phase-deadline').length, 1);
    const idleErrors = [];
    const retrying = client().events('/feed?id=phase-idle', { idleTimeoutMs: 35, reconnect: { maxRetries: 1, initialDelayMs: 1 }, onError: (e) => { idleErrors.push(e.phase); if (idleErrors.length === 2) retrying.close(); } });
    await retrying.opened;
    await retrying.closed;
    assert.deepEqual(idleErrors, ['idle', 'idle']);
    assert.equal(connections.get('phase-idle').length, 2);
  });

  it('reuses generated idempotency keys across SSE reconnections without changing caller options', async () => {
    const c = new WasmClient({ baseUrl: server.url('/v1'), idempotencyKey: true });
    const { all, onEvent } = collector(2);
    const options = Object.freeze({ method: 'POST', body: 'x', reconnect: { maxRetries: 1, initialDelayMs: 0 }, onEvent, idempotencyKey: true });
    const stream = c.events('/resume?id=key-resume', options);
    await all;
    stream.close();
    await stream.closed;
    const requests = connections.get('key-resume');
    assert.equal(requests.length, 2);
    assert.ok(requests[0].headers['idempotency-key']);
    assert.equal(requests[0].headers['idempotency-key'], requests[1].headers['idempotency-key']);
    assert.equal(options.idempotencyKey, true);
  });

  it('overrides connection retries independently of reconnection', async () => {
    const c = new WasmClient({ baseUrl: server.url('/v1'), retries: { maxRetries: 2, initialDelayMs: 0 } });
    const disabled = c.events('/status?code=503&id=retry-disabled', { retries: 0, reconnect: false });
    assert.equal((await rejection(disabled.opened)).status, 503);
    await disabled.closed;
    assert.equal(connections.get('retry-disabled').length, 1);

    const enabled = new WasmClient().events(server.url('/v1/status?code=503&id=retry-enabled'), {
      retries: { maxRetries: 1, initialDelayMs: 0 }, reconnect: false,
    });
    assert.equal((await rejection(enabled.opened)).status, 503);
    await enabled.closed;
    assert.equal(connections.get('retry-enabled').length, 2);

    const reconnected = c.events('/status?code=503&id=retry-reconnected', {
      retries: 0, reconnect: { maxRetries: 1, initialDelayMs: 0 },
    });
    assert.equal((await rejection(reconnected.opened)).status, 503);
    await reconnected.closed;
    assert.equal(connections.get('retry-reconnected').length, 2, 'disabling connection retries still permits reconnection');

    assert.throws(() => c.events('/feed', { retries: -1 }), (e) => e.kind === 'InvalidInputError' && e.parameter === 'retries');
  });

  it('parses events and sends the event-stream headers, client headers and interceptors', async () => {
    const c = client({ headers: { 'x-client': '1' } });
    c.addRequestInterceptor((request) => {
      request.headers['x-intercepted'] = 'yes';
    });
    const { events, all, onEvent } = collector(3);
    const stream = c.events('/feed', { params: { id: 'feed', topic: 'news' }, onEvent });
    assert.equal(stream.url, server.url('/v1/feed?id=feed&topic=news'));
    assert.equal(stream.state, 'connecting');
    await stream.opened;
    assert.equal(stream.state, 'open');
    await all;
    assert.deepEqual(events, [
      { event: 'message', data: 'first', id: '' },
      { event: 'update', data: 'line 1\nline 2', id: '7' },
      { event: 'message', data: 'Zoë 🦀', id: '7' }, // split mid-character across chunks
    ]);
    assert.equal(stream.lastEventId, '7');
    const { headers } = connections.get('feed')[0];
    assert.equal(headers.accept, 'text/event-stream');
    assert.equal(headers['cache-control'], undefined); // would force a CORS preflight in browsers
    assert.equal(headers['x-client'], '1');
    assert.equal(headers['x-intercepted'], 'yes');
    stream.close();
    await stream.closed;
    assert.equal(stream.state, 'closed');
  });

  it('is an async iterator, and break closes the stream', async () => {
    const stream = client().events('/count?id=iterate');
    const seen = [];
    for await (const { data } of stream) {
      seen.push(data);
      if (seen.length === 3) break;
    }
    assert.deepEqual(seen, ['1', '2', '3']);
    await stream.closed;
    assert.equal(stream.state, 'closed');
    assert.deepEqual(await stream.next(), { value: undefined, done: true });
  });

  it('streams a POST JSON API until [DONE], without reconnecting', async () => {
    let text = '';
    const stream = client().events('/llm?id=llm', {
      method: 'POST',
      body: { model: 'm', stream: true },
      messageType: 'json',
    });
    for await (const { data } of stream) {
      text += data.choices[0].delta.content;
    }
    assert.equal(text, 'Hello, world');
    const [request] = connections.get('llm');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(request.body), { model: 'm', stream: true });
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(connections.get('llm').length, 1);
  });

  it('reconnects with Last-Event-ID, after the delay the server asked for', async () => {
    const reconnects = [];
    const { events, all, onEvent } = collector(2);
    const stream = client().events('/resume?id=resume', { onEvent, onReconnect: (info) => reconnects.push(info) });
    await all;
    assert.deepEqual(events.map((e) => e.data), ['before', 'after 1']);
    assert.equal(reconnects.length, 1);
    assert.equal(reconnects[0].attempt, 1);
    assert.equal(reconnects[0].delayMs, 50);
    assert.equal(reconnects[0].error.kind, 'NetworkError');
    assert.equal(connections.get('resume')[1].headers['last-event-id'], '1');
    stream.close();
    await stream.closed;
  });

  it('stops on 204 No Content', async () => {
    const stream = client().events('/no-content?id=204');
    assert.equal((await rejection(stream.opened)).kind, 'CancelledError');
    await stream.closed;
    assert.equal(connections.get('204').length, 1);
  });

  it('fails on a response that is not an event stream, and on client errors', async () => {
    const errors = [];
    const html = client().events('/html?id=html', { onError: (e) => errors.push(e) });
    const notStream = await rejection(html.opened);
    assert.equal(notStream.kind, 'ParseError');
    assert.match(notStream.message, /text\/event-stream.*text\/html/);
    assert.equal(errors[0], notStream);

    const missing = client().events('/status?code=404&id=404');
    const httpError = await rejection(missing.opened);
    assert.equal(httpError.kind, 'HttpError');
    assert.equal(httpError.status, 404);
    assert.equal(connections.get('404').length, 1); // not retried

    // An iterator rethrows the error
    await assert.rejects(async () => {
      for await (const _ of client().events('/html')) break;
    }, (error) => error.kind === 'ParseError');
  });

  it('reconnects after server errors and network failures until maxRetries', async () => {
    const reconnects = [];
    const busy = client().events('/status?code=503&id=503', { reconnect: { maxRetries: 2, initialDelayMs: 1 }, onReconnect: (i) => reconnects.push(i.attempt) });
    const error = await rejection(busy.opened);
    assert.equal(error.kind, 'HttpError');
    assert.equal(error.status, 503);
    assert.deepEqual(reconnects, [1, 2]);
    assert.equal(connections.get('503').length, 3);

    const closed = await startServer(() => {});
    const url = closed.url('/');
    await closed.close();
    const refused = new WasmClient().events(url, { reconnect: 1 });
    assert.equal((await rejection(refused.opened)).kind, 'NetworkError');
  });

  it('reports bad JSON to onError and continues, but ends an iterator with it', async () => {
    const errors = [];
    const { events, all, onEvent } = collector(2);
    client().events('/bad-json?id=json1', { messageType: 'json', reconnect: false, onEvent, onError: (e) => errors.push(e.kind) });
    await all;
    assert.deepEqual(events.map((e) => e.data), [{ ok: 1 }, { ok: 2 }]);
    assert.deepEqual(errors, ['ParseError']);

    const seen = [];
    await assert.rejects(async () => {
      for await (const { data } of client().events('/bad-json?id=json2', { messageType: 'json', reconnect: false })) seen.push(data);
    }, (error) => error.kind === 'ParseError');
    assert.deepEqual(seen, [{ ok: 1 }]);
  });

  it('an iterator that reads slowly holds the server back instead of buffering every event', async () => {
    const stream = new WasmClient().events(server.url('/v1/flood'));
    let read = 0;
    let paused, later;
    for await (const event of stream) {
      assert.equal(event.data.length, 1016);
      if (++read === 1) {
        await sleep(500);
        paused = flood.written;
        await sleep(500);
        later = flood.written;
      }
      if (read === 2) break;
    }
    // Without backpressure, the server keeps writing while the loop is paused and the events are
    // queued; with it, the server stops once the socket and stream buffers are full. How much fits
    // depends on the OS (about 830 events on macOS, over 5,000 on Linux, which autotunes loopback
    // buffers), so this checks that writing stopped, not where
    assert.ok(paused < FLOOD_EVENTS, `the server wrote all ${FLOOD_EVENTS} events`);
    assert.ok(later - paused < 100, `the server wrote ${later - paused} more events while the loop was paused (${later} of ${FLOOD_EVENTS})`);
    for (let i = 0; i < 100 && !flood.closed; i++) await sleep(10);
    assert.ok(flood.closed, 'break closed the connection');
  });

  it('a paused stream resumes and delivers every event, in order', async () => {
    const received = [];
    for await (const event of new WasmClient().events(server.url('/v1/flood?n=3000'), { reconnect: false })) {
      received.push(Number(event.data.slice(0, 8)));
      if (received.length % 500 === 1) await sleep(100);
      if (received.length === 3000) break;
    }
    assert.deepEqual(received, Array.from({ length: 3000 }, (_, i) => i));
  });

  it('ends the stream at a line over maxLineBytes, without reconnecting, and closes the connection', async () => {
    for (const query of ['', '&comment=1']) {
      flood.closed = false;
      const id = query ? "long-line-comment" : "long-line";
      const stream = new WasmClient({ maxLineBytes: 16 }).events(server.url(`/v1/long-line?id=${id}${query}`));
      const received = [];
      const error = await rejection(
        (async () => {
          for await (const event of stream) received.push(event.data);
        })(),
      );
      // Each data line is checked, not the event's total
      assert.deepEqual(received, ['ok\nalso ok']);
      assert.equal(error.kind, 'NetworkError');
      assert.equal(error.maxLineBytes, 16);
      assert.equal(stream.state, 'closed');
      for (let i = 0; i < 100 && !flood.closed; i++) await sleep(10);
      assert.ok(flood.closed, 'the connection was closed');
      assert.equal(connections.get(id).length, 1, 'not reconnected');
    }
    // A stream can lift the client's limit
    const events = [];
    for await (const event of new WasmClient({ maxLineBytes: 16 }).events(server.url('/v1/long-line?id=lifted'), { maxLineBytes: null })) {
      events.push(event.data);
      if (events.length === 2) break;
    }
    assert.equal(events[1], 'd'.repeat(16));
  });

  it('maxEventBytes limits an event’s data across its lines, at the exact boundary', async () => {
    const read = async (lines, size, options = {}) => {
      flood.closed = false;
      const id = `event-size-${lines}-${size}-${JSON.stringify(options)}`;
      const stream = new WasmClient({ maxEventBytes: 1000 }).events(server.url(`/v1/event-size?id=${encodeURIComponent(id)}&lines=${lines}&size=${size}`), options);
      const received = [];
      const error = await (async () => {
        for await (const event of stream) {
          received.push(event.data.length);
          if (event.data === 'after') break;
        }
      })().catch((e) => e);
      return { received, error, reconnects: connections.get(id).length - 1 };
    };
    // One line of exactly 1000 bytes; three of 332 (+ 2 joining newlines = 998)
    assert.deepEqual((await read(1, 1000)).received, [2, 1000, 5]);
    assert.deepEqual((await read(3, 332)).received, [2, 998, 5]);
    // One byte over, in one line or across three (3 × 333 + 2 = 1001)
    for (const [lines, size] of [[1, 1001], [3, 333], [50, 100]]) {
      const { received, error, reconnects } = await read(lines, size);
      assert.deepEqual(received, [2], 'the event before it was delivered');
      assert.equal(error.kind, 'NetworkError');
      assert.equal(error.maxEventBytes, 1000);
      assert.match(error.message, /Event larger than maxEventBytes \(1000 bytes\)/);
      assert.equal(reconnects, 0, 'not reconnected');
      for (let i = 0; i < 100 && !flood.closed; i++) await sleep(10);
      assert.ok(flood.closed, 'the connection was closed');
    }
    // Per stream: another limit, or none
    assert.deepEqual((await read(3, 333, { maxEventBytes: 1001 })).received, [2, 1001, 5]);
    assert.deepEqual((await read(50, 100, { maxEventBytes: null })).received, [2, 5049, 5]);
  });

  it('closes when the signal aborts', async () => {
    const aborted = client().events('/feed', { signal: AbortSignal.abort() });
    assert.equal((await rejection(aborted.opened)).kind, 'CancelledError');
    assert.equal(aborted.state, 'closed');

    const controller = new AbortController();
    let closedCalls = 0;
    const stream = client().events('/feed?id=signal', { signal: controller.signal, onEvent() {}, onClose: () => closedCalls++ });
    await stream.opened;
    controller.abort();
    await stream.closed;
    stream.close(); // no-op once closed
    assert.equal(closedCalls, 1);
  });

  it('rejects invalid options', () => {
    for (const value of [0, -1, 1.5, '8']) {
      assert.throws(() => new WasmClient({ maxEventBytes: value }), (e) => e.kind === 'InvalidInputError' && e.parameter === 'maxEventBytes', String(value));
      assert.throws(() => new WasmClient().events(server.url('/v1/feed'), { maxEventBytes: value }), (e) => e.parameter === 'maxEventBytes', String(value));
    }
    const c = client();
    const invalid = (fn, parameter) => assert.throws(fn, (e) => e.kind === 'InvalidInputError' && e.parameter === parameter);
    invalid(() => c.events('/feed', { method: 1 }), 'method');
    invalid(() => c.events('/feed', { method: 'TRACE' }), 'method');
    invalid(() => c.events('/feed', { messageType: 'xml' }), 'messageType');
    invalid(() => c.events('/feed', { end: 1 }), 'end');
    invalid(() => c.events('/feed', { signal: {} }), 'signal');
    invalid(() => c.events('/feed', { onEvent: 'x' }), 'onEvent');
    invalid(() => c.events('/feed', { reconnect: 'x' }), 'reconnect');
    invalid(() => c.events('/feed', { timeoutMs: -1 }), 'timeoutMs');
    invalid(() => c.events('/feed', { headers: { 'bad header': '1' } }), 'headers');
    invalid(() => new WasmClient().events('/relative'), 'url');
  });
});
