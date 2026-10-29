// Servers for the conformance suite: one handler on two origins
// (127.0.0.1 and localhost on different ports), so redirects can cross an
// origin. Every response carries CORS headers, so real browsers can run the
// same cases from a page on the first origin.
import http from 'node:http';
import zlib from 'node:zlib';

const json = (res, value, status = 200, headers = {}) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bomb = zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024));
const compressed = {
  gzip: (data) => zlib.gzipSync(data),
  deflate: (data) => zlib.deflateSync(data),
  br: (data) => zlib.brotliCompressSync(data),
  zstd: typeof zlib.zstdCompressSync === 'function' ? (data) => zlib.zstdCompressSync(data) : undefined,
};

/** Start both origins; `extra` lets the runner serve the browser page and the package */
export async function startServers(extra = () => false) {
  // Requests seen, per `id` query parameter, so a case can ask what reached a server
  const seen = new Map();
  // For /flood, per id: bytes written so far, and whether the client closed the connection
  const floods = new Map();
  const record = (id, entry) => {
    if (!id) return;
    if (!seen.has(id)) seen.set(id, []);
    seen.get(id).push(entry);
  };

  const handler = (origin) => async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const id = url.searchParams.get('id');
    const cors = {
      'access-control-allow-origin': req.headers.origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'location, content-encoding',
    };
    for (const [name, value] of Object.entries(cors)) res.setHeader(name, value);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
        'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
      });
      return res.end();
    }
    if (extra(req, res)) return;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    record(id, {
      origin,
      path: url.pathname,
      method: req.method,
      body,
      authorization: req.headers.authorization ?? null,
      apiKey: req.headers['x-api-key'] ?? null,
    });

    switch (url.pathname) {
      case '/fault/reset':
        return req.socket.destroy();
      case '/fault/truncated':
        res.writeHead(200, { 'content-length': 1000, 'content-type': 'text/plain' });
        res.write('short');
        return res.socket.end();
      case '/fault/headers':
        res.setHeader('x-oversized', 'x'.repeat(1024 * 1024));
        return res.end('ok');
      case '/fault/idle':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('first');
        return;
      case '/fault/drip': {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('x');
        const interval = setInterval(() => res.write('x'), 30);
        res.once('close', () => clearInterval(interval));
        return;
      }
      case '/fault/sse-idle':
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(': keepalive\n\n');
        return;
      case '/fault/sse-reconnect-storm':
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return res.end((seen.get(id)?.length ?? 0) <= 2
          ? ': accepted then closed\n\n'
          : 'data: recovered\n\ndata: [DONE]\n\n');
      case '/fault/half-open':
        req.socket.pause();
        return;
      case '/fault/slow':
        await sleep(30);
        return json(res, { ok: true });
      case '/fault/trace':
        return json(res, { traceparent: req.headers.traceparent ?? null, tracestate: req.headers.tracestate ?? null });
      case '/fault/redirect-error':
        res.writeHead(302, { location: '/status?code=503' });
        return res.end();
      case '/fault/recovery':
        if ((seen.get(id)?.length ?? 0) === 1) return json(res, { retry: true }, 503, { 'retry-after': '0' });
        return json(res, { recovered: true });
      case '/echo':
        return json(res, { origin, method: req.method, body });
      case '/v1/target':
      case '/target':
        // The request target as it arrived (path and query)
        return json(res, { target: req.url });
      case '/seen':
        return json(res, seen.get(url.searchParams.get('of')) ?? []);
      case '/flood-progress':
        return json(res, floods.get(url.searchParams.get('of')) ?? null);
      case '/flood': {
        // Up to 64 MB as fast as the client takes it (64 kB chunks, or 1 kB NDJSON lines)
        const progress = { written: 0, closed: false };
        floods.set(id, progress);
        const ndjson = url.searchParams.has('ndjson');
        const chunk = ndjson ? Buffer.from(`"${'x'.repeat(1021)}"\n`) : Buffer.alloc(64 * 1024, 120);
        let resume;
        res.on('close', () => {
          progress.closed = true;
          resume?.();
        });
        res.on('drain', () => resume?.());
        res.writeHead(200, { 'content-type': ndjson ? 'application/x-ndjson' : 'application/octet-stream' });
        while (progress.written < 64 * 1024 * 1024 && !res.destroyed) {
          progress.written += chunk.length;
          if (!res.write(chunk)) await new Promise((r) => (resume = r));
        }
        return res.end();
      }
      case '/redirect': {
        // to: a path (same origin) or `other` for the same path on the other origin
        const status = Number(url.searchParams.get('status') ?? 302);
        let to = url.searchParams.get('to') ?? '/echo';
        if (url.searchParams.get('other')) to = `${servers.other(origin)}${to}`;
        res.writeHead(status, { location: to, 'content-type': 'text/plain' });
        return res.end('redirecting');
      }
      case '/loop':
        res.writeHead(302, { location: '/loop' });
        return res.end();
      case '/hops': {
        const n = Number(url.searchParams.get('n'));
        if (n === 0) return json(res, { arrived: true });
        res.writeHead(302, { location: `/hops?n=${n - 1}&id=${id ?? ''}` });
        return res.end();
      }
      case '/status': {
        const code = Number(url.searchParams.get('code'));
        res.writeHead(code, { 'content-type': 'text/plain' });
        return res.end(`status ${code}`);
      }
      case '/encoded': {
        // Encoded whatever the client asked for, so each adapter's decoder is tested
        // (Node's fetch(), for one, doesn't ask for br)
        const encoding = url.searchParams.get('encoding');
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': encoding });
        return res.end(compressed[encoding](Buffer.from(JSON.stringify({ decoded: true }))));
      }
      case '/corrupt':
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
        return res.end(Buffer.from('this is not gzip'));
      case '/bomb':
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip' });
        return res.end(bomb);
      case '/bytes': {
        const n = Number(url.searchParams.get('n'));
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(Buffer.alloc(n, 120));
      }
      case '/bad-json':
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{"truncated":');
      case '/slow':
        await sleep(Number(url.searchParams.get('ms') ?? 1000));
        return json(res, { slow: true });
      case '/slow-body': {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('first,');
        await sleep(Number(url.searchParams.get('ms') ?? 1000));
        return res.end('second');
      }
      case '/hang':
        return; // never answers
      case '/stream': {
        res.writeHead(200, { 'content-type': 'text/plain' });
        for (const part of ['one,', 'two,', 'three']) {
          res.write(part);
          await sleep(10);
        }
        return res.end();
      }
      case '/stream-error': {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '100' });
        res.write('partial');
        await sleep(20);
        return res.destroy();
      }
      case '/ndjson':
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        return res.end('{"n":1}\n{"n":2}\r\n\n{"n":3}');
      case '/ndjson-long':
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        return res.end(`{"n":1}\n"${'x'.repeat(100)}"\n{"n":3}\n`);
      case '/events':
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: one\n\nevent: update\ndata: two\nid: 7\n\n');
        if (url.searchParams.get('big')) res.write(`data: ${'x'.repeat(60)}\ndata: ${'y'.repeat(60)}\n\n`);
        return res.end('data: [DONE]\n\n');
      case '/flaky': {
        // 503 on the first `fail` attempts for each id
        const attempts = seen.get(id).length;
        if (attempts <= Number(url.searchParams.get('fail') ?? 1)) {
          res.writeHead(503, { 'content-type': 'text/plain' });
          return res.end('busy');
        }
        return json(res, { attempts });
      }
      default:
        return json(res, { error: 'no route' }, 404);
    }
  };

  const start = (host, origin) =>
    new Promise((resolve) => {
      const server = http.createServer(handler(origin));
      server.listen(0, host, () => resolve(server));
    });
  const a = await start('127.0.0.1', 'a');
  const b = await start('127.0.0.1', 'b');
  const servers = {
    a: `http://127.0.0.1:${a.address().port}`,
    // The same host by another name: another origin for cross-origin redirects
    b: `http://localhost:${b.address().port}`,
    other: (origin) => (origin === 'a' ? servers.b : servers.a),
    close: () => {
      for (const server of [a, b]) {
        server.closeAllConnections();
        server.close();
      }
    },
  };
  return servers;
}
