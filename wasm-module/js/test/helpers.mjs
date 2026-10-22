import crypto from 'node:crypto';
import http from 'node:http';

/**
 * Start a local HTTP server. `handler(req, res, ctx)` gets the parsed request
 * (`req.body` is a Buffer) and `ctx.count`, the 0-based index of the request.
 * Every request is recorded in `server.requests`; `server.connections()` is
 * the number of connections accepted so far.
 */
export async function startServer(handler) {
  const requests = [];
  const sockets = new Set();
  let connections = 0;
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
    connections++;
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    url: (path = '/') => base + path,
    requests,
    connections: () => connections,
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

/**
 * A minimal WebSocket server (RFC 6455) for the client tests.
 * `onConnection(peer, req)` gets each accepted connection; requests to
 * `/reject` get a 403 and requests to `/hang` never get a response.
 * `server.handshakes` records each handshake's URL and headers.
 */
export async function startWebSocketServer(onConnection = () => {}) {
  const handshakes = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    res.writeHead(426);
    res.end();
  });
  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    handshakes.push({ url: req.url, headers: req.headers });
    if (req.url.startsWith('/reject')) return socket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n');
    if (req.url.startsWith('/hang')) return;
    const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    const [protocol] = (req.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const lines = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`];
    if (protocol) lines.push(`Sec-WebSocket-Protocol: ${protocol}`);
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    onConnection(new WebSocketPeer(socket), req);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    url: (path = '/') => `ws://127.0.0.1:${port}${path}`,
    httpUrl: (path = '/') => `http://127.0.0.1:${port}${path}`,
    handshakes,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** The server side of one WebSocket connection */
class WebSocketPeer {
  messages = [];
  onmessage = null;
  #buffer = Buffer.alloc(0);
  #closeSent = false;

  constructor(socket) {
    this.socket = socket;
    socket.on('data', (data) => this.#receive(data));
  }

  #receive(data) {
    this.#buffer = Buffer.concat([this.#buffer, data]);
    while (this.#buffer.length >= 2) {
      const opcode = this.#buffer[0] & 0x0f;
      let length = this.#buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.#buffer.length < 4) return;
        length = this.#buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.#buffer.length < 10) return;
        length = Number(this.#buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const mask = this.#buffer.subarray(offset, offset + 4); // clients always mask
      offset += 4;
      if (this.#buffer.length < offset + length) return;
      const payload = Buffer.from(this.#buffer.subarray(offset, offset + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      this.#buffer = this.#buffer.subarray(offset + length);
      if (opcode === 0x8) {
        // Echo the client's close frame (unless this side started), then end
        if (!this.#closeSent) this.#frame(0x8, payload);
        this.#closeSent = true;
        this.socket.end();
      } else if (opcode === 0x9) {
        this.#frame(0xa, payload);
      } else {
        const message = opcode === 0x1 ? payload.toString('utf8') : payload;
        this.messages.push(message);
        this.onmessage?.(message);
      }
    }
  }

  #frame(opcode, payload) {
    const length = payload.length;
    const header = length < 126 ? Buffer.from([0x80 | opcode, length]) : Buffer.alloc(length < 65536 ? 4 : 10);
    if (length >= 126 && length < 65536) {
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else if (length >= 65536) {
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(data) {
    if (typeof data === 'string') this.#frame(0x1, Buffer.from(data));
    else this.#frame(0x2, Buffer.from(data));
  }

  /** Start a clean close; the client's echo ends the connection */
  close(code = 1000, reason = '') {
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.#frame(0x8, payload);
    this.#closeSent = true;
  }

  /** Drop the connection without a close frame (the client sees 1006) */
  drop() {
    this.socket.destroy();
  }
}
