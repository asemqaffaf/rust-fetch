// WasmClient.events(): Server-Sent Events against a local server, in Node.js.
// Run `npm run build` first.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WasmClient } from '../../pkg/node.js';
import { rejection, sleep, startServer } from './helpers.mjs';

let server;
const connections = new Map(); // per test id: requests seen

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
