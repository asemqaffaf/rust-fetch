// The conformance cases: one behaviour each, run unchanged on every adapter
// (node:http, native, fetch() in Node.js, real browsers). A case's `run` is
// serialized and evaluated with `HELPERS` in front of it, so it may use only
// those helpers, `rf` (the package's exports) and `ctx`:
//   ctx.a, ctx.b   the two origins (see server.mjs)
//   ctx.closed     a URL nothing listens on
//   ctx.id(name)   a request id unique to this adapter, for /seen
//
// `expect` is the observation every adapter should make; `differs` lists the
// adapters allowed another one (`expect`, or `anyOf` where the platform itself
// varies), each with the reason. Anything else fails.

/** Helpers available to every case */
export const HELPERS = `
  const { WasmClient } = rf;
  /** A rejection's typed details, or a response's status and body */
  const outcome = async (promise) => {
    try {
      const res = await promise;
      return { status: res.status, body: res.body };
    } catch (error) {
      return failure(error);
    }
  };
  const failure = (error) => {
    const details = { error: error.kind ?? error.name };
    for (const key of ['status', 'parameter', 'timeoutMs', 'maxResponseBytes', 'maxLineBytes', 'maxEventBytes', 'maxPendingRequests', 'retryBudgetExhausted']) {
      if (error[key] !== undefined) details[key] = error[key];
    }
    return details;
  };
  /** What reached the servers for a request id */
  const seen = async (id) => (await fetch(ctx.a + '/seen?of=' + encodeURIComponent(id))).json();
  /** Read a ReadableStream to the end: its text, or the error that ended it */
  const drain = async (stream) => {
    const reader = stream.getReader();
    const parts = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return { text: parts.join('') };
        parts.push(typeof value === 'string' ? value : new TextDecoder().decode(value));
      }
    } catch (error) {
      return { text: parts.join(''), ...failure(error) };
    }
  };
  /** Read an async iterable to the end: its items, or the error that ended it */
  const collect = async (iterable) => {
    const items = [];
    try {
      for await (const item of iterable) items.push(item);
      return { items };
    } catch (error) {
      return { items, ...failure(error) };
    }
  };
`;

const browsers = ['chromium', 'firefox', 'webkit'];
const inBrowsers = (expect, why) => Object.fromEntries(browsers.map((name) => [name, { expect, why }]));
const outsideNode = (expect, why) => ({ 'fetch()': { expect, why }, ...inBrowsers(expect, why) });

export const cases = [
  // --- Redirects ---------------------------------------------------------------------
  ...[301, 302, 303, 307, 308].map((status) => ({
    id: `redirect-get-${status}`,
    area: 'Redirects',
    title: `GET through a ${status} is followed`,
    run: `async (rf, ctx) => outcome(new WasmClient().get(ctx.a + '/redirect?status=${status}&to=/echo'))`,
    expect: { status: 200, body: { origin: 'a', method: 'GET', body: '' } },
  })),
  ...[
    [301, 'GET', ''],
    [302, 'GET', ''],
    [303, 'GET', ''],
    [307, 'POST', 'payload'],
    [308, 'POST', 'payload'],
  ].map(([status, method, body]) => ({
    id: `redirect-post-${status}`,
    area: 'Redirects',
    title: `POST through a ${status} becomes ${method}${body ? ' with its body' : ', without a body'}`,
    run: `async (rf, ctx) => outcome(new WasmClient().post(ctx.a + '/redirect?status=${status}&to=/echo', { body: 'payload' }))`,
    expect: { status: 200, body: { origin: 'a', method, body } },
  })),
  {
    id: 'redirect-put-303',
    area: 'Redirects',
    title: 'PUT through a 303 becomes GET without a body',
    run: `async (rf, ctx) => outcome(new WasmClient().put(ctx.a + '/redirect?status=303&to=/echo', { body: 'payload' }))`,
    expect: { status: 200, body: { origin: 'a', method: 'GET', body: '' } },
  },
  {
    id: 'redirect-credentials',
    area: 'Redirects',
    title: 'Authorization is dropped on a cross-origin redirect, kept on a same-origin one',
    run: `async (rf, ctx) => {
      const client = new WasmClient({ headers: { authorization: 'Bearer secret' } });
      const id = ctx.id('credentials');
      await client.get(ctx.a + '/redirect?to=' + encodeURIComponent('/echo?id=' + id) + '&id=' + id).catch(() => {});
      await client.get(ctx.a + '/redirect?other=1&to=' + encodeURIComponent('/echo?id=' + id) + '&id=' + id).catch(() => {});
      return (await seen(id)).map((r) => [r.origin, r.path, r.authorization]);
    }`,
    expect: [
      ['a', '/redirect', 'Bearer secret'],
      ['a', '/echo', 'Bearer secret'],
      ['a', '/redirect', 'Bearer secret'],
      ['b', '/echo', null],
    ],
  },
  {
    id: 'redirect-sensitive-headers',
    area: 'Redirects',
    title: 'sensitiveHeaders are dropped on a cross-origin redirect',
    run: `async (rf, ctx) => {
      const client = new WasmClient({ headers: { 'x-api-key': 'secret' }, sensitiveHeaders: ['x-api-key'] });
      const id = ctx.id('sensitive');
      await client.get(ctx.a + '/redirect?other=1&to=' + encodeURIComponent('/echo?id=' + id) + '&id=' + id).catch(() => {});
      return (await seen(id)).map((r) => [r.origin, r.apiKey]);
    }`,
    expect: [
      ['a', 'secret'],
      ['b', null],
    ],
    differs: outsideNode(
      [
        ['a', 'secret'],
        ['b', 'secret'],
      ],
      "fetch() follows redirects itself, so sensitiveHeaders can't apply (documented)",
    ),
  },
  {
    id: 'redirect-max',
    area: 'Redirects',
    title: 'maxRedirects: 2 stops a third redirect',
    run: `async (rf, ctx) => [
      await outcome(new WasmClient({ maxRedirects: 2 }).get(ctx.a + '/hops?n=2')),
      await outcome(new WasmClient({ maxRedirects: 2 }).get(ctx.a + '/hops?n=3')),
    ]`,
    expect: [{ status: 200, body: { arrived: true } }, { error: 'NetworkError' }],
    differs: outsideNode(
      [
        { status: 200, body: { arrived: true } },
        { status: 200, body: { arrived: true } },
      ],
      "fetch() has no redirect-limit option; it applies its own limit (20) instead (documented)",
    ),
  },
  {
    id: 'redirect-loop',
    area: 'Redirects',
    title: 'A redirect loop fails',
    run: `async (rf, ctx) => outcome(new WasmClient().get(ctx.a + '/loop'))`,
    expect: { error: 'NetworkError' },
  },
  {
    id: 'redirect-manual',
    area: 'Redirects',
    title: "redirect: 'manual' returns the 3xx",
    run: `async (rf, ctx) => outcome(new WasmClient({ redirect: 'manual' }).get(ctx.a + '/redirect?to=/echo', { responseType: 'text' }))`,
    expect: { status: 302, body: 'redirecting' },
    differs: inBrowsers({ status: 0, body: '' }, 'browsers return an opaque redirect: status 0 and an empty body (documented)'),
  },
  {
    id: 'redirect-error',
    area: 'Redirects',
    title: "redirect: 'error' rejects a redirect",
    run: `async (rf, ctx) => outcome(new WasmClient({ redirect: 'error' }).get(ctx.a + '/redirect?to=/echo'))`,
    expect: { error: 'NetworkError' },
  },
  {
    id: 'redirect-scheme',
    area: 'Redirects',
    title: 'A redirect to another scheme (data:) is refused',
    run: `async (rf, ctx) => outcome(new WasmClient().get(ctx.a + '/redirect?to=' + encodeURIComponent('data:text/plain,hi')))`,
    expect: { error: 'NetworkError' },
  },

  // --- Decompression -----------------------------------------------------------------
  ...['gzip', 'deflate', 'br'].map((encoding) => ({
    id: `decode-${encoding}`,
    area: 'Decompression',
    title: `${encoding} is decoded`,
    run: `async (rf, ctx) => outcome(new WasmClient().get(ctx.a + '/encoded?encoding=${encoding}'))`,
    expect: { status: 200, body: { decoded: true } },
  })),
  {
    id: 'decode-corrupt',
    area: 'Decompression',
    title: 'A corrupt gzip body fails',
    run: `async (rf, ctx) => outcome(new WasmClient().get(ctx.a + '/corrupt'))`,
    expect: { error: 'NetworkError' },
    differs: {
      webkit: {
        anyOf: [{ error: 'NetworkError' }, { status: 200, body: 'this is not gzip' }],
        why: "WebKit decodes responses itself: on macOS a corrupt gzip body fails, but on Linux (libsoup) it's passed through as it arrived, which rust-fetch can't detect",
      },
    },
  },
  {
    id: 'decode-bomb',
    area: 'Decompression',
    title: 'A 64 MB gzip bomb stops at maxResponseBytes',
    run: `async (rf, ctx) => outcome(new WasmClient({ maxResponseBytes: 1048576 }).get(ctx.a + '/bomb', { responseType: 'binary' }))`,
    expect: { error: 'NetworkError', maxResponseBytes: 1048576 },
  },

  // --- Size limits -------------------------------------------------------------------
  {
    id: 'size-boundary',
    area: 'Size limits',
    title: 'maxResponseBytes: exactly at the limit passes, one byte more fails',
    run: `async (rf, ctx) => {
      const client = new WasmClient({ maxResponseBytes: 1000 });
      const at = await outcome(client.get(ctx.a + '/bytes?n=1000', { responseType: 'binary' }));
      return [at.body?.length ?? at, await outcome(client.get(ctx.a + '/bytes?n=1001', { responseType: 'binary' }))];
    }`,
    expect: [1000, { error: 'NetworkError', maxResponseBytes: 1000 }],
  },
  {
    id: 'size-stream',
    area: 'Size limits',
    title: 'maxResponseBytes errors a streamed body once it passes the limit',
    run: `async (rf, ctx) => {
      const res = await new WasmClient({ maxResponseBytes: 1000 }).get(ctx.a + '/bytes?n=5000', { responseType: 'stream' });
      const { text, ...rest } = await drain(res.body);
      return { read: text.length <= 1000, ...rest };
    }`,
    expect: { read: true, error: 'NetworkError', maxResponseBytes: 1000 },
  },

  // --- Timeouts and cancellation -----------------------------------------------------
  {
    id: 'timeout-headers',
    area: 'Timeouts and cancellation',
    title: 'A timeout before the headers is a TimeoutError',
    run: `async (rf, ctx) => outcome(new WasmClient({ timeoutMs: 100 }).get(ctx.a + '/hang'))`,
    expect: { error: 'TimeoutError', timeoutMs: 100 },
  },
  {
    id: 'timeout-body',
    area: 'Timeouts and cancellation',
    title: 'The timeout covers reading the body',
    run: `async (rf, ctx) => outcome(new WasmClient({ timeoutMs: 200 }).get(ctx.a + '/slow-body?ms=1000', { responseType: 'text' }))`,
    expect: { error: 'TimeoutError', timeoutMs: 200 },
  },
  {
    id: 'cancel-before',
    area: 'Timeouts and cancellation',
    title: 'An already-aborted signal rejects without sending',
    run: `async (rf, ctx) => {
      const id = ctx.id('cancel-before');
      const result = await outcome(new WasmClient().get(ctx.a + '/echo?id=' + id, { signal: AbortSignal.abort() }));
      return [result, (await seen(id)).length];
    }`,
    expect: [{ error: 'CancelledError' }, 0],
  },
  {
    id: 'cancel-waiting',
    area: 'Timeouts and cancellation',
    title: 'Aborting while waiting for the response is a CancelledError',
    run: `async (rf, ctx) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);
      return outcome(new WasmClient().get(ctx.a + '/hang', { signal: controller.signal }));
    }`,
    expect: { error: 'CancelledError' },
  },
  {
    id: 'cancel-stream',
    area: 'Timeouts and cancellation',
    title: 'Aborting mid-stream errors the body with a CancelledError',
    run: `async (rf, ctx) => {
      const controller = new AbortController();
      const res = await new WasmClient().get(ctx.a + '/slow-body?ms=2000', { responseType: 'stream', signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      return drain(res.body);
    }`,
    expect: { text: 'first,', error: 'CancelledError' },
  },

  // --- Errors ------------------------------------------------------------------------
  {
    id: 'error-refused',
    area: 'Errors',
    title: 'A refused connection is a NetworkError',
    run: `async (rf, ctx) => outcome(new WasmClient().get(ctx.closed))`,
    expect: { error: 'NetworkError' },
  },
  {
    id: 'error-http',
    area: 'Errors',
    title: 'A 404 is an HttpError with the status',
    run: `async (rf, ctx) => outcome(new WasmClient().get(ctx.a + '/status?code=404'))`,
    expect: { error: 'HttpError', status: 404 },
  },
  {
    id: 'error-bad-json-auto',
    area: 'Errors',
    title: 'Malformed JSON falls back to text by default',
    run: `async (rf, ctx) => outcome(new WasmClient().get(ctx.a + '/bad-json'))`,
    expect: { status: 200, body: '{"truncated":' },
  },
  {
    id: 'error-bad-json',
    area: 'Errors',
    title: "Malformed JSON with responseType: 'json' is a ParseError",
    run: `async (rf, ctx) => outcome(new WasmClient().get(ctx.a + '/bad-json', { responseType: 'json' }))`,
    expect: { error: 'ParseError' },
  },
  {
    id: 'error-header-injection',
    area: 'Errors',
    title: 'CR/LF in a header value is an InvalidInputError, before sending',
    run: `async (rf, ctx) => {
      const id = ctx.id('crlf');
      const result = await outcome(new WasmClient().get(ctx.a + '/echo?id=' + id, { headers: { 'x-a': 'v\\r\\nx-injected: 1' } }));
      return [result, (await seen(id)).length];
    }`,
    expect: [{ error: 'InvalidInputError', parameter: 'request' }, 0],
  },
  {
    id: 'error-retries',
    area: 'Errors',
    title: 'A 503 is retried, and the retry succeeds',
    run: `async (rf, ctx) => outcome(new WasmClient({ retries: { maxRetries: 2, initialDelayMs: 1 } }).get(ctx.a + '/flaky?fail=1&id=' + ctx.id('flaky')))`,
    expect: { status: 200, body: { attempts: 2 } },
  },

  // --- Streaming ---------------------------------------------------------------------
  {
    id: 'stream-text',
    area: 'Streaming',
    title: 'A streamed body arrives in full',
    run: `async (rf, ctx) => drain((await new WasmClient().get(ctx.a + '/stream', { responseType: 'stream' })).body)`,
    expect: { text: 'one,two,three' },
  },
  {
    id: 'stream-dropped',
    area: 'Streaming',
    title: 'A connection dropped mid-body errors the stream with a NetworkError',
    run: `async (rf, ctx) => drain((await new WasmClient().get(ctx.a + '/stream-error', { responseType: 'stream' })).body)`,
    expect: { text: 'partial', error: 'NetworkError' },
  },
  {
    id: 'stream-ndjson',
    area: 'Streaming',
    title: 'NDJSON: \\n and \\r\\n, empty lines skipped, a last line without a newline',
    run: `async (rf, ctx) => collect((await new WasmClient().get(ctx.a + '/ndjson', { responseType: 'ndjson' })).body)`,
    expect: { items: [{ n: 1 }, { n: 2 }, { n: 3 }] },
  },
  {
    id: 'stream-max-line',
    area: 'Streaming',
    title: 'maxLineBytes: the lines before a long one, then a NetworkError',
    run: `async (rf, ctx) => collect((await new WasmClient({ maxLineBytes: 64 }).get(ctx.a + '/ndjson-long', { responseType: 'ndjson' })).body)`,
    expect: { items: [{ n: 1 }], error: 'NetworkError', maxLineBytes: 64 },
  },
  {
    id: 'events',
    area: 'Streaming',
    title: 'Server-Sent Events: types, ids and multi-line data, until [DONE]',
    run: `async (rf, ctx) => collect(new WasmClient().events(ctx.a + '/events', { end: '[DONE]', reconnect: false }))`,
    expect: {
      items: [
        { event: 'message', data: 'one', id: '' },
        { event: 'update', data: 'two', id: '7' },
      ],
    },
  },
  {
    id: 'events-max-event',
    area: 'Streaming',
    title: 'maxEventBytes: the events before a large one, then a NetworkError',
    run: `async (rf, ctx) => {
      const { items, ...rest } = await collect(new WasmClient({ maxEventBytes: 100 }).events(ctx.a + '/events?big=1', { reconnect: false }));
      return { items: items.map((event) => event.data), ...rest };
    }`,
    expect: { items: ['one', 'two'], error: 'NetworkError', maxEventBytes: 100 },
  },

  // --- Security ----------------------------------------------------------------------
  {
    id: 'security-base-url',
    area: 'Security',
    title: 'Paths like //host stay under baseUrl',
    run: `async (rf, ctx) => outcome(new WasmClient({ baseUrl: ctx.a + '/v1' }).get('//' + new URL(ctx.b).host + '/echo'))`,
    expect: { error: 'HttpError', status: 404 },
  },
  {
    id: 'security-absolute-url',
    area: 'Security',
    title: 'allowAbsoluteUrls: false refuses an absolute URL, before sending',
    run: `async (rf, ctx) => {
      const id = ctx.id('absolute');
      const result = await outcome(new WasmClient({ baseUrl: ctx.a + '/v1', allowAbsoluteUrls: false }).get(ctx.b + '/echo?id=' + id));
      return [result, (await seen(id)).length];
    }`,
    expect: [{ error: 'InvalidInputError', parameter: 'url' }, 0],
  },
  {
    id: 'security-private-network',
    area: 'Security',
    title: 'allowPrivateNetwork: false blocks 127.0.0.1, before sending',
    run: `async (rf, ctx) => {
      const id = ctx.id('private');
      const result = await outcome(new WasmClient({ allowPrivateNetwork: false }).get(ctx.a + '/echo?id=' + id));
      return [result, (await seen(id)).length];
    }`,
    expect: [{ error: 'NetworkError' }, 0],
    differs: outsideNode(
      [{ status: 200, body: { origin: 'a', method: 'GET', body: '' } }, 1],
      'only the Node.js entry checks addresses; browsers enforce their own private-network rules (documented)',
    ),
  },
  {
    id: 'security-pending',
    area: 'Security',
    title: 'maxPendingRequests refuses one more, without sending it',
    run: `async (rf, ctx) => {
      const client = new WasmClient({ maxPendingRequests: 2 });
      const id = ctx.id('pending');
      const first = [client.get(ctx.a + '/slow?ms=200'), client.get(ctx.a + '/slow?ms=200')];
      const refused = await outcome(client.get(ctx.a + '/echo?id=' + id));
      await Promise.all(first);
      return [refused, (await seen(id)).length];
    }`,
    expect: [{ error: 'NetworkError', maxPendingRequests: 2 }, 0],
  },
  {
    id: 'security-retry-budget',
    area: 'Security',
    title: 'retryBudget refuses a retry, keeping the attempt’s error',
    run: `async (rf, ctx) => {
      const client = new WasmClient({ retries: { maxRetries: 3, initialDelayMs: 1 }, retryBudget: { ratio: 0, minPerSecond: 0.1 } });
      return outcome(client.get(ctx.a + '/flaky?fail=10&id=' + ctx.id('budget')));
    }`,
    expect: { error: 'HttpError', status: 503, retryBudgetExhausted: true },
  },
];
