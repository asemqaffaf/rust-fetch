// Secret-leak canaries (#227). Unique strings go into the URL (user, password,
// query, fragment), headers, a proxy password and the body. Failing, timing-out,
// redirected, retried, cancelled and blocked requests are run, and everything
// the client lets the application observe is searched for them: thrown errors
// (message, stack, own properties, `cause` chain), debug entries, lifecycle
// hooks, `stats()` and anything written to the console.
//
// Documented behaviour (docs/guide/observability.md#redaction-and-logging):
// the library's own observers never see credentials, URL user info, query or
// fragment; error objects keep the URL as passed unless `redactUrl` is set.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import util from 'node:util';
import { pathToFileURL } from 'node:url';

const pkg = process.env.RUST_FETCH_PKG ? pathToFileURL(`${process.env.RUST_FETCH_PKG}/`).href : new URL('../../pkg/', import.meta.url).href;
const { WasmClient } = await import(new URL('node.js', pkg).href);

const CANARY = {
  urlUser: 'CANARY_URL_USER', urlPassword: 'CANARY_URL_PASSWORD', urlQuery: 'CANARY_URL_QUERY', urlFragment: 'CANARY_URL_FRAGMENT',
  authorization: 'CANARY_AUTHORIZATION', cookie: 'CANARY_COOKIE', apiKey: 'CANARY_API_KEY', proxyPassword: 'CANARY_PROXY_PASSWORD', body: 'CANARY_BODY',
};
const URL_PARTS = ['urlUser', 'urlPassword', 'urlQuery', 'urlFragment'];
const NEVER_IN_ERRORS = ['authorization', 'cookie', 'apiKey', 'proxyPassword', 'body'];
const found = (text) => Object.entries(CANARY).filter(([, value]) => text.includes(value)).map(([name]) => name);

/** Everything an error shows: message, stack, own properties, inspection, and the same for each `cause` */
function describeError(error, { cause = true } = {}) {
  const parts = [];
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    // util.inspect would print the cause too, so describe a cause-free copy when it is excluded
    const shown = cause ? value : Object.defineProperty(Object.create(Object.getPrototypeOf(value), Object.getOwnPropertyDescriptors(value)), 'cause', { value: undefined, enumerable: false });
    parts.push(String(value.message), String(value.stack), String(value), util.inspect(shown, { depth: 8, showHidden: true }));
    try { parts.push(JSON.stringify(shown, Object.getOwnPropertyNames(shown))); } catch { /* circular */ }
    if (cause) walk(value.cause);
  };
  walk(error);
  return parts.join('\n');
}

let server;
let port;
let closedPort;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/500')) { res.statusCode = 500; res.end('server error'); }
    else if (req.url.startsWith('/redirect')) { res.statusCode = 302; res.setHeader('location', `http://localhost:${server.address().port}/500?hop=2`); res.end(); }
    else if (req.url.startsWith('/big')) res.end('x'.repeat(10_000));
    else if (req.url.startsWith('/hang')) { /* never answers */ }
    else res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  closedPort = await new Promise((resolve) => {
    const probe = http.createServer().listen(0, '127.0.0.1', () => { const free = probe.address().port; probe.close(() => resolve(free)); });
  });
});
after(() => { server.closeAllConnections?.(); server.close(); });

const headers = () => ({ authorization: `Bearer ${CANARY.authorization}`, cookie: `sid=${CANARY.cookie}`, 'x-api-key': CANARY.apiKey });
const url = (path, targetPort = port) => `http://${CANARY.urlUser}:${CANARY.urlPassword}@127.0.0.1:${targetPort}${path}${path.includes('?') ? '&' : '?'}token=${CANARY.urlQuery}#${CANARY.urlFragment}`;
const redactAll = (value) => { const parsed = new URL(value); parsed.username = ''; parsed.password = ''; parsed.search = ''; parsed.hash = ''; return parsed.href; };

// `kind` is the error each scenario must end in, so a scenario cannot pass by failing for another reason
const SCENARIOS = {
  'connection refused': () => ({ kind: 'NetworkError', target: () => url('/', closedPort) }),
  'server error': () => ({ kind: 'HttpError', target: () => url('/500') }),
  'redirect to another host name, then an error': () => ({ kind: 'HttpError', target: () => url('/redirect') }),
  'timeout': () => ({ kind: 'TimeoutError', options: { timeoutMs: 150 }, target: () => url('/hang') }),
  'retries exhausted': () => ({ kind: 'HttpError', options: { retries: 2 }, target: () => url('/500') }),
  'proxy refused': () => ({ kind: 'NetworkError', options: { proxy: `http://proxyuser:${CANARY.proxyPassword}@127.0.0.1:${closedPort}` }, target: () => url('/') }),
  'response too large': () => ({ kind: 'NetworkError', options: { maxResponseBytes: 100 }, target: () => url('/big') }),
  'private network blocked': () => ({ kind: 'NetworkError', options: { allowPrivateNetwork: false }, target: () => url('/') }),
  'cancelled': () => { const controller = new AbortController(); setTimeout(() => controller.abort(), 50); return { kind: 'CancelledError', target: () => url('/hang'), request: { signal: controller.signal } }; },
};

/** Run one request and collect every surface */
async function run(scenario, extraOptions = {}) {
  const { kind, options = {}, target, request = {} } = scenario();
  const debug = [];
  const hooks = [];
  const consoleOutput = [];
  const originals = {};
  for (const method of ['log', 'debug', 'info', 'warn', 'error']) {
    originals[method] = console[method];
    console[method] = (...args) => consoleOutput.push(args.map((arg) => (typeof arg === 'string' ? arg : util.inspect(arg, { depth: 6 }))).join(' '));
  }
  const client = new WasmClient({
    retries: 0, timeoutMs: 2000, headers: headers(), sensitiveHeaders: ['x-api-key'],
    debug: (entry) => debug.push(JSON.stringify(entry)),
    onRequestStart: (entry) => hooks.push(JSON.stringify(entry)),
    onRequestEnd: (entry) => hooks.push(JSON.stringify(entry)),
    ...options, ...extraOptions,
  });
  let error;
  try { await client.post(target(), { body: { password: CANARY.body }, ...request }); } catch (caught) { error = caught; } finally {
    for (const [method, original] of Object.entries(originals)) console[method] = original;
  }
  return { kind, error, debug: debug.join('\n'), hooks: hooks.join('\n'), stats: JSON.stringify(client.stats?.() ?? {}), consoleOutput: consoleOutput.join('\n') };
}

describe('secrets do not leak', () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    describe(name, () => {
      let result;
      before(async () => { result = await run(scenario); });

      it('ends in the error the scenario is for', () => {
        assert.ok(result.error, 'expected the request to fail');
        assert.equal(result.error.name, result.kind, result.error.message);
      });
      it('keeps every secret out of debug entries', () => assert.deepEqual(found(result.debug), []));
      it('keeps every secret out of lifecycle hooks', () => assert.deepEqual(found(result.hooks), []));
      it('keeps every secret out of stats()', () => assert.deepEqual(found(result.stats), []));
      it('writes no secret to the console', () => assert.deepEqual(found(result.consoleOutput), []));
      it('keeps headers, proxy password and body out of the error', () => {
        const leaked = found(describeError(result.error)).filter((part) => NEVER_IN_ERRORS.includes(part));
        assert.deepEqual(leaked, []);
      });

      // Without redactUrl the error keeps the URL as passed, minus the password and the fragment (#238)
      it('keeps the URL password and fragment out of the error', () => {
        assert.deepEqual(found(describeError(result.error)).filter((part) => part === 'urlPassword' || part === 'urlFragment'), []);
      });

      it('keeps all URL parts out of the error itself when redactUrl is set', async () => {
        const redacted = await run(scenario, { redactUrl: redactAll });
        assert.ok(redacted.error);
        assert.deepEqual(found(describeError(redacted.error, { cause: false })).filter((part) => URL_PARTS.includes(part)), []);
      });

      it('keeps all URL parts out of the error cause when redactUrl is set', async () => {
        const redacted = await run(scenario, { redactUrl: redactAll });
        assert.ok(redacted.error);
        assert.deepEqual(found(describeError(redacted.error)).filter((part) => URL_PARTS.includes(part)), []);
      });
    });
  }

  it('debug: true (console.debug) writes entries without secrets', async () => {
    const lines = [];
    const original = console.debug;
    console.debug = (...args) => lines.push(args.map((arg) => (typeof arg === 'string' ? arg : util.inspect(arg, { depth: 6 }))).join(' '));
    try {
      const client = new WasmClient({ retries: 0, timeoutMs: 2000, headers: headers(), sensitiveHeaders: ['x-api-key'], debug: true });
      await client.get(url('/500')).catch(() => {});
    } finally { console.debug = original; }
    assert.ok(lines.length > 0, 'expected debug entries');
    assert.deepEqual(found(lines.join('\n')), []);
  });
});
