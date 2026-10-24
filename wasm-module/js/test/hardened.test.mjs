// The hardened configurations in README.md ("Hardened configurations"),
// read from the README itself and checked against local servers: each
// protection a configuration's comments claim is exercised here, so the
// README can't drift from what the client does. Run `npm run build` first.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WasmClient } from '../../pkg/node.js';
import { json, rejection, sleep, startServer } from './helpers.mjs';

const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');

/** The code block after `<!-- hardened:name -->` */
function block(name) {
  const match = readme.match(new RegExp(`<!-- hardened:${name} -->\\n\`\`\`js\\n([\\s\\S]*?)\`\`\``));
  assert.ok(match, `README has a hardened:${name} block`);
  return match[1];
}

/** The source of the argument list after `call(` (up to its closing parenthesis) */
function argumentsOf(code, call) {
  const start = code.indexOf(call);
  assert.ok(start >= 0, `${call} in the block`);
  let depth = 0;
  for (let i = start + call.length - 1; i < code.length; i++) {
    if (code[i] === '(') depth++;
    if (code[i] === ')' && --depth === 0) return code.slice(start + call.length, i);
  }
  throw new Error(`unbalanced ${call}`);
}

/** Evaluate a configuration's source with the README's placeholders bound */
const evaluate = (source, values = {}) => new Function(...Object.keys(values), `return [${source}];`)(...Object.values(values));

const clientOptions = (name) => evaluate(argumentsOf(block(name), 'new WasmClient('), { token: 'SECRET' })[0];

let api;
let attacker;
before(async () => {
  attacker = await startServer((req, res) => json(res, { attacker: true }));
  api = await startServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/^\/v1/, '');
    switch (path) {
      case '/redirect':
        res.writeHead(302, { location: url.searchParams.get('to') });
        return res.end();
      case '/hops': {
        // /hops?n=3 redirects 3 times, then answers
        const n = Number(url.searchParams.get('n'));
        if (n === 0) return json(res, { arrived: true });
        res.writeHead(302, { location: `/hops?n=${n - 1}` });
        return res.end();
      }
      case '/fail':
        res.writeHead(503);
        return res.end('busy');
      case '/big':
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(Buffer.alloc(Number(url.searchParams.get('mb')) * 1024 * 1024));
      case '/slow':
        await sleep(300);
        return json(res, { slow: true });
      case '/chat': {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ echo: JSON.parse(req.body.toString()) })}\n\n`);
        if (url.searchParams.has('long')) res.write(`data: ${'x'.repeat(1024 * 1024)}\n\n`);
        return; // stays open
      }
      case '/ndjson':
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        return res.end(`{"ok":true}\n"${'x'.repeat(1024 * 1024)}"\n`);
      default:
        return json(res, { path });
    }
  });
});

after(async () => {
  await api.close();
  await attacker.close();
});

/** Start `count` requests that stay pending, then check one more is refused */
async function refusesBeyond(client, count, url) {
  const pending = Array.from({ length: count }, () => client.get(url));
  const error = await rejection(client.get(url));
  assert.equal(error.maxPendingRequests, count);
  await Promise.all(pending);
}

describe('hardened configuration: a fixed API with credentials', () => {
  const options = clientOptions('api');
  const client = () => new WasmClient({ ...options, baseUrl: api.url('/v1') });

  it('keeps the token with its host: absolute URLs and redirects are refused', async () => {
    assert.equal(options.headers.authorization, 'Bearer SECRET');
    assert.equal((await rejection(client().get(attacker.url('/steal')))).kind, 'InvalidInputError');
    const redirected = await rejection(client().get(`/redirect?to=${encodeURIComponent(attacker.url('/steal'))}`));
    assert.equal(redirected.kind, 'NetworkError');
    assert.equal(attacker.requests.length, 0, 'nothing reached the other host');
    assert.equal((await client().get('/items')).body.path, '/items');
  });

  it('retries idempotent requests within a retry budget, and never POST', async () => {
    const c = client();
    const before = api.requests.length;
    assert.equal((await rejection(c.get('/fail'))).status, 503);
    assert.equal(api.requests.length - before, 3, 'the first attempt and 2 retries');
    await rejection(c.post('/fail', { body: 'x' }));
    assert.equal(api.requests.length - before, 4, 'POST: one attempt');
    assert.equal(options.timeoutMs, 10_000);
  });

  it('refuses retries beyond the retry budget, keeping the attempt’s error', async () => {
    // The default budget allows 100 retries per 10 s plus 0.2 per request: 80 failing
    // requests at once want 160 retries, so some must be refused
    const c = client();
    const before = api.requests.length;
    const errors = await Promise.all(Array.from({ length: 80 }, () => rejection(c.get('/fail'))));
    const refused = errors.filter((error) => error.retryBudgetExhausted);
    assert.ok(refused.length > 0, 'a retry was refused');
    assert.ok(refused.every((error) => error.status === 503));
    assert.equal(c.retriesRefused, refused.length);
    assert.ok(api.requests.length - before < 80 * 3, 'fewer attempts than without a budget');
  });

  it('sheds load beyond 256 pending requests and limits responses to 10 MB', async () => {
    await refusesBeyond(client(), 256, '/slow');
    assert.equal((await rejection(client().get('/big?mb=11'))).maxResponseBytes, 10 * 1024 * 1024);
    assert.equal((await client().get('/big?mb=1', { responseType: 'binary' })).body.length, 1024 * 1024);
  });
});

describe('hardened configuration: fetching URLs from users', () => {
  const options = clientOptions('fetcher');

  it('sends no credentials and reaches nothing internal, before connecting', async () => {
    assert.equal(options.headers, undefined);
    const fetcher = new WasmClient(options);
    const before = api.requests.length;
    for (const url of [api.url('/'), 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:9/', 'http://10.0.0.5/']) {
      assert.match((await rejection(fetcher.get(url))).message, /Blocked/, url);
    }
    assert.equal(api.requests.length, before, 'nothing was sent');
  });

  // The test server is on 127.0.0.1, so the rest lifts allowPrivateNetwork to reach it
  const reachable = () => new WasmClient({ ...options, allowPrivateNetwork: true });

  it('follows at most 3 redirects, limits responses to 5 MB and sheds load beyond 100 pending', async () => {
    assert.deepEqual((await reachable().get(api.url('/hops?n=3'))).body, { arrived: true });
    assert.match((await rejection(reachable().get(api.url('/hops?n=4')))).message, /Too many redirects \(more than 3\)/);
    assert.equal((await rejection(reachable().get(api.url('/big?mb=6')))).maxResponseBytes, 5 * 1024 * 1024);
    await refusesBeyond(reachable(), 100, api.url('/slow'));
    assert.equal(options.timeoutMs, 5_000);
  });
});

describe('hardened configuration: streaming APIs', () => {
  const code = block('streaming');
  const options = clientOptions('streaming');
  const client = () => new WasmClient({ ...options, baseUrl: api.url('/v1') });
  /**
   * The README's `events()` arguments. Its `AbortSignal.timeout(…)` is recorded and
   * replaced with a `shortMs` timeout, so the deadline can be tested without the wait.
   */
  const events = (shortMs = 60_000) => {
    const deadlines = [];
    const FakeAbortSignal = { timeout: (ms) => (deadlines.push(ms), AbortSignal.timeout(shortMs)) };
    const [path, options] = evaluate(argumentsOf(code, '.events('), {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      AbortSignal: FakeAbortSignal,
    });
    return { path: path.replace('/v1/chat/completions', '/chat'), options, deadlines };
  };
  const streamOptions = events().options;

  it('streams the request as written', async () => {
    const { path, options } = events();
    for await (const event of client().events(path, options)) {
      assert.deepEqual(event.data.echo, { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true });
      break;
    }
  });

  it('ends the whole stream at the README’s deadline: 5 minutes', async () => {
    const { path, options, deadlines } = events(200);
    assert.deepEqual(deadlines, [5 * 60_000], 'AbortSignal.timeout(5 * 60_000)');
    const stream = client().events(path, options);
    const started = performance.now();
    await stream.opened;
    await stream.closed; // the server keeps the stream open; only the deadline ends it
    const elapsed = performance.now() - started;
    assert.equal(stream.state, 'closed');
    assert.ok(elapsed >= 100 && elapsed < 2000, `closed after ${elapsed.toFixed(0)} ms (deadline 200 ms)`);
  });

  it('ends a stream at a line over 1 MB, for events and NDJSON', async () => {
    const stream = client().events('/chat?long=1', { ...streamOptions, signal: undefined });
    const error = await rejection(
      (async () => {
        for await (const event of stream) assert.ok(event.data.echo);
      })(),
    );
    assert.equal(error.maxLineBytes, 1024 * 1024);
    const res = await client().get('/ndjson', { responseType: 'ndjson' });
    const values = [];
    const ndjsonError = await rejection(
      (async () => {
        for await (const value of res.body) values.push(value);
      })(),
    );
    assert.deepEqual(values, [{ ok: true }]);
    assert.equal(ndjsonError.maxLineBytes, 1024 * 1024);
  });

  it('keeps the token with its host and sheds load beyond 64 pending', async () => {
    assert.equal((await rejection(client().get(attacker.url('/steal')))).kind, 'InvalidInputError');
    assert.throws(() => client().events(attacker.url('/steal')), (e) => e.kind === 'InvalidInputError');
    await refusesBeyond(client(), 64, '/slow');
    assert.equal(options.timeoutMs, 30_000);
  });
});
