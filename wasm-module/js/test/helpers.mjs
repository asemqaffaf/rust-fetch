import http from 'node:http';

/**
 * Start a local HTTP server. `handler(req, res, ctx)` gets the parsed request
 * (`req.body` is a Buffer) and `ctx.count`, the 0-based index of the request.
 * Every request is recorded in `server.requests`.
 */
export async function startServer(handler) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      req.body = Buffer.concat(chunks);
      const ctx = { count: requests.length };
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: req.body });
      try {
        await handler(req, res, ctx);
      } catch (error) {
        res.statusCode = 500;
        res.end(String(error));
      }
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    url: (path = '/') => base + path,
    requests,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

export function json(res, value, { status = 200, type = 'application/json' } = {}) {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof value === 'string' ? value : JSON.stringify(value));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Await a promise expected to reject; returns the rejection reason. */
export async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}
