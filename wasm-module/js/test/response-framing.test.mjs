// Hostile server responses (#228). A raw TCP server sends malformed framing and
// the client must reject it, bound it, or at least never act on a smuggled or
// partial message. The framing itself is parsed by Node's HTTP parser on the
// node:http transport, so this also catches a Node release that becomes more
// lenient. Nothing here needs the network.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const pkg = process.env.RUST_FETCH_PKG ? pathToFileURL(`${process.env.RUST_FETCH_PKG}/`).href : new URL('../../pkg/', import.meta.url).href;
const { WasmClient } = await import(new URL('node.js', pkg).href);

// The native addon runs these too when it is built (`npm run build:native`); the
// -js file runs them again with it switched off. The two parsers differ in what
// they tolerate, so a few cases below are judged by what they must never do.
const native = process.env.RUST_FETCH_NATIVE !== '0' && existsSync(new URL(`../../pkg/rust-fetch-native.${process.platform}-${process.arch}.node`, import.meta.url));
const CRLF = '\r\n';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A TCP server that calls `handler(socket)` for each connection */
async function serve(handler) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => { for (const socket of sockets) socket.destroy(); server.close(); },
  };
}

/** Answer the first request on a connection with `raw` (and end the connection when `end`) */
const reply = (raw, end = false) => (socket) => socket.once('data', () => { socket.write(raw); if (end) socket.end(); });
const head = (lines, body = '') => `HTTP/1.1 200 OK${CRLF}${lines.join(CRLF)}${CRLF}${CRLF}${body}`;
const chunked = (...lines) => head(['Transfer-Encoding: chunked'], lines.join(''));

async function outcome(raw, { end = false, options = {} } = {}) {
  const server = await serve(reply(raw, end));
  const client = new WasmClient({ retries: 0, timeoutMs: 1500, ...options });
  try {
    const response = await client.get(server.url);
    return { ok: true, status: response.status, headers: Object.keys(response.headers ?? {}) };
  } catch (error) {
    return { ok: false, error };
  } finally {
    server.close();
  }
}

describe('malformed responses are rejected', () => {
  // Rejected by every Node release this package supports
  const MUST_REJECT = {
    'conflicting Content-Length values': head(['Content-Length: 2', 'Content-Length: 5'], 'ok'),
    'chunk size that is not hexadecimal': chunked(`zz${CRLF}ok${CRLF}0${CRLF}${CRLF}`),
    'chunk size beyond 64 bits': chunked(`ffffffffffffffffff${CRLF}ok${CRLF}0${CRLF}${CRLF}`),
    'negative chunk size': chunked(`-2${CRLF}ok${CRLF}0${CRLF}${CRLF}`),
    'chunk data not followed by CRLF': chunked(`2${CRLF}okXX0${CRLF}${CRLF}`),
    'a 100 kB chunk extension': chunked(`2;${'a'.repeat(100_000)}${CRLF}ok${CRLF}0${CRLF}${CRLF}`),
    'a 100 kB trailer': chunked(`2${CRLF}ok${CRLF}0${CRLF}X: ${'a'.repeat(100_000)}${CRLF}${CRLF}`),
    'a 2 MB header': head([`X-Big: ${'a'.repeat(2_000_000)}`, 'Content-Length: 2'], 'ok'),
    '5000 headers': head([...Array.from({ length: 5000 }, (_, index) => `H${index}: v`), 'Content-Length: 2'], 'ok'),
    'a 2 MB status line': `HTTP/1.1 200 ${'a'.repeat(2_000_000)}${CRLF}Content-Length: 2${CRLF}${CRLF}ok`,
    'text that is not HTTP': `this is not http${CRLF}${CRLF}`,
    'a bare body (HTTP/0.9 style)': 'ok',
    'an unknown HTTP version': `HTTP/9.9 200 OK${CRLF}Content-Length: 2${CRLF}${CRLF}ok`,
    'a four digit status': `HTTP/1.1 1000 Odd${CRLF}Content-Length: 2${CRLF}${CRLF}ok`,
  };
  for (const [name, raw] of Object.entries(MUST_REJECT)) {
    it(`rejects ${name}`, async () => {
      const result = await outcome(raw);
      assert.equal(result.ok, false, `accepted with status ${result.status}`);
      assert.equal(result.error.kind, 'NetworkError', result.error.message);
    });
  }

  it('rejects a body shorter than its Content-Length', async () => {
    const result = await outcome(head(['Content-Length: 10'], 'ok'), { end: true });
    assert.equal(result.ok, false);
  });

  // Strict parsers reject these; a lenient one may accept them. If one does, the
  // response must still be the one the server meant: no extra header, no split message.
  const MAY_REJECT = {
    'obsolete line folding': head(['X-A: one', ' two', 'Content-Length: 2'], 'ok'),
    'bare LF line endings': 'HTTP/1.1 200 OK\nContent-Length: 2\n\nok',
    'a bare CR inside a header value': head(['X-A: a\rb', 'Content-Length: 2'], 'ok'),
    'a NUL inside a header value': head(['X-A: a\u0000b', 'Content-Length: 2'], 'ok'),
    'a space before the header colon': head(['Content-Length : 2'], 'ok'),
    'a space inside a header name': head(['X A: 1', 'Content-Length: 2'], 'ok'),
  };
  for (const [name, raw] of Object.entries(MAY_REJECT)) {
    it(`rejects ${name}, or reads it without inventing headers`, async () => {
      const result = await outcome(raw);
      if (!result.ok) return assert.equal(result.error.kind, 'NetworkError', result.error.message);
      assert.equal(result.status, 200);
      assert.ok(result.headers.every((header) => ['x-a', 'content-length', 'content-length '].includes(header.toLowerCase())), `unexpected headers ${result.headers}`);
    });
  }

  it('accepts a header block just under the 16 kB default limit', async () => {
    const result = await outcome(head([`X-Big: ${'a'.repeat(15_000)}`, 'Content-Length: 2'], 'ok'));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  });
});

describe('where the two parsers differ', () => {
  it('reads a 100 kB header or status line as the response the server sent, or rejects it', async () => {
    for (const raw of [
      head([`X-Big: ${'a'.repeat(100_000)}`, 'Content-Length: 2'], 'ok'),
      `HTTP/1.1 200 ${'a'.repeat(100_000)}${CRLF}Content-Length: 2${CRLF}${CRLF}ok`,
    ]) {
      const result = await outcome(raw);
      if (result.ok) assert.equal(result.status, 200);
      else assert.equal(result.error.kind, 'NetworkError', result.error.message);
    }
  });

  // RFC 9112 6.3: a response with both headers is incorrectly framed, and the connection must not be reused after it
  async function connectionsUsed() {
    let connections = 0;
    let requests = 0;
    const server = await serve((socket) => {
      connections++;
      socket.on('data', () => {
        requests++;
        socket.write(requests === 1
          ? head(['Content-Length: 2', 'Transfer-Encoding: chunked'], `2${CRLF}ok${CRLF}0${CRLF}${CRLF}`)
          : head(['Content-Length: 4'], 'real'));
      });
    });
    try {
      const client = new WasmClient({ retries: 0, timeoutMs: 2000 });
      await client.get(server.url).then(() => undefined, () => undefined);
      await sleep(50);
      await client.get(server.url).then(() => undefined, () => undefined);
      return connections;
    } finally { server.close(); }
  }

  it('does not reuse the connection after Content-Length together with Transfer-Encoding', { todo: native ? 'the native transport reuses it (#243; hyper drops Content-Length before the addon sees it)' : false }, async () => {
    assert.equal(await connectionsUsed(), 2, 'the second request was sent on the connection the malformed response arrived on');
  });

  // node:test does not fail a suite when a todo test starts passing, so today's behaviour is pinned as well
  it('KNOWN GAP (#243): the native transport reuses the connection', { skip: !native }, async () => {
    assert.equal(await connectionsUsed(), 1, 'the gap seems to be closed: remove the todo marker above and this test');
  });
});

describe('a server cannot push a second response onto a reused connection', () => {
  it('answers the next request with the next response, never an unsolicited one', async () => {
    let requests = 0;
    const ok = (body) => `HTTP/1.1 200 OK${CRLF}Content-Type: text/plain${CRLF}Content-Length: ${body.length}${CRLF}${CRLF}${body}`;
    const server = await serve((socket) => socket.on('data', () => {
      requests++;
      if (requests === 1) {
        socket.write(ok('first'));
        setTimeout(() => socket.write(ok('SMUGGLED')), 30);
      } else socket.write(ok(`real-${requests}`));
    }));
    try {
      const client = new WasmClient({ retries: 0, timeoutMs: 2000 });
      assert.equal(await (await client.get(server.url)).body, 'first');
      await sleep(150);
      const second = await client.get(server.url);
      assert.notEqual(second.body, 'SMUGGLED');
      assert.equal(second.body, 'real-2');
    } finally { server.close(); }
  });

  it('never shows bytes sent after the declared length, even when they are a whole response', async () => {
    let requests = 0;
    const ok = (body) => `HTTP/1.1 200 OK${CRLF}Content-Type: text/plain${CRLF}Content-Length: ${body.length}${CRLF}${CRLF}${body}`;
    const server = await serve((socket) => socket.on('data', () => {
      requests++;
      socket.write(requests === 1 ? ok('first') + ok('SMUGGLED') : ok(`real-${requests}`));
    }));
    try {
      const client = new WasmClient({ retries: 0, timeoutMs: 2000 });
      const first = await client.get(server.url).then((response) => response, () => undefined);
      if (first) assert.equal(first.body, 'first');
      await sleep(100);
      const second = await client.get(server.url);
      assert.equal(second.body, 'real-2');
    } finally { server.close(); }
  });
});

describe('a server cannot hold a request open without limit', () => {
  const elapsed = async (promise) => { const start = Date.now(); const result = await promise; return { result, ms: Date.now() - start }; };

  it('headers that arrive one line at a time end at timeoutMs', async () => {
    const server = await serve((socket) => socket.once('data', () => {
      socket.write(`HTTP/1.1 200 OK${CRLF}`);
      const timer = setInterval(() => socket.write(`X-A: 1${CRLF}`), 100);
      socket.on('close', () => clearInterval(timer));
    }));
    try {
      const client = new WasmClient({ retries: 0, timeoutMs: 600 });
      const { result, ms } = await elapsed(client.get(server.url).then(() => undefined, (error) => error));
      assert.equal(result?.name, 'TimeoutError');
      assert.ok(ms < 2000, `took ${ms} ms`);
    } finally { server.close(); }
  });

  it('an endless run of 1xx responses ends at responseTimeoutMs, with little memory', async () => {
    const server = await serve((socket) => socket.once('data', () => {
      const timer = setInterval(() => socket.write(`HTTP/1.1 103 Early Hints${CRLF}Link: </a.css>; rel=preload${CRLF}${CRLF}`), 5);
      socket.on('close', () => clearInterval(timer));
    }));
    try {
      const client = new WasmClient({ retries: 0, timeoutMs: 0, responseTimeoutMs: 500 });
      const before = process.memoryUsage().rss;
      const { result, ms } = await elapsed(client.get(server.url).then(() => undefined, (error) => error));
      assert.equal(result?.name, 'TimeoutError');
      assert.equal(result?.phase, 'response');
      assert.ok(ms < 2000, `took ${ms} ms`);
      assert.ok(process.memoryUsage().rss - before < 50 * 1024 * 1024, 'memory grew by more than 50 MB');
    } finally { server.close(); }
  });

  it('a body that trickles forever ends at deadlineMs', async () => {
    const server = await serve((socket) => socket.once('data', () => {
      socket.write(`HTTP/1.1 200 OK${CRLF}Transfer-Encoding: chunked${CRLF}${CRLF}`);
      const timer = setInterval(() => socket.write(`1${CRLF}x${CRLF}`), 50);
      socket.on('close', () => clearInterval(timer));
    }));
    try {
      const client = new WasmClient({ retries: 0, timeoutMs: 0, deadlineMs: 600 });
      const { result, ms } = await elapsed(client.get(server.url).then(() => undefined, (error) => error));
      assert.equal(result?.name, 'TimeoutError');
      assert.ok(ms < 2000, `took ${ms} ms`);
    } finally { server.close(); }
  });

  it('a declared Content-Length above maxResponseBytes is refused before the body is read', async () => {
    const server = await serve((socket) => socket.once('data', () => {
      socket.write(`HTTP/1.1 200 OK${CRLF}Content-Length: 10000000000${CRLF}${CRLF}`);
      const timer = setInterval(() => socket.write('x'.repeat(1000)), 50);
      socket.on('close', () => clearInterval(timer));
    }));
    try {
      const client = new WasmClient({ retries: 0, timeoutMs: 3000, maxResponseBytes: 1000 });
      const { result, ms } = await elapsed(client.get(server.url).then(() => undefined, (error) => error));
      assert.match(result?.message ?? '', /larger than maxResponseBytes/);
      assert.ok(ms < 1000, `took ${ms} ms`);
    } finally { server.close(); }
  });
});
