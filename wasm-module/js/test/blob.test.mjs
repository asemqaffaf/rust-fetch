// responseType: 'blob' (#81) on Node.js, where Blob is global.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import init, { WasmClient } from '../../pkg/node.js';
import { createMockTransport } from '../../pkg/testing.js';
import { rejection, startServer } from './helpers.mjs';

const PDF = Buffer.from('%PDF-1.7 fake');
let server;
before(async () => {
  await init();
  server = await startServer((req, res) => {
    if (req.url === '/invoice.pdf') {
      res.writeHead(200, { 'content-type': 'Application/PDF', 'content-length': PDF.length });
      return res.end(PDF);
    }
    if (req.url === '/text') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('héllo');
    }
    if (req.url === '/empty') return res.writeHead(204).end();
    if (req.url === '/missing') return res.writeHead(404, { 'content-type': 'text/plain' }).end('no');
    res.writeHead(200).end(PDF);
  });
});
after(() => server.close());

const client = () => new WasmClient({ baseUrl: server.url('').replace(/\/$/, ''), retries: 0 });

describe("responseType: 'blob'", () => {
  it('returns a Blob typed with the Content-Type', async () => {
    const response = await client().get('/invoice.pdf', { responseType: 'blob' });
    assert.ok(response.body instanceof Blob);
    assert.equal(response.body.type, 'application/pdf');
    assert.equal(response.body.size, PDF.length);
    assert.deepEqual(Buffer.from(await response.body.arrayBuffer()), PDF);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'Application/PDF');
  });

  it('keeps media type parameters, and an empty type without a Content-Type', async () => {
    const text = await client().get('/text', { responseType: 'blob' });
    assert.equal(text.body.type, 'text/plain; charset=utf-8');
    assert.equal(await text.body.text(), 'héllo');
    assert.equal((await client().get('/other', { responseType: 'blob' })).body.type, '');
  });

  it('gives an empty Blob for an empty body', async () => {
    const response = await client().get('/empty', { responseType: 'blob' });
    assert.ok(response.body instanceof Blob);
    assert.equal(response.body.size, 0);
    const head = await client().head('/invoice.pdf', { responseType: 'blob' });
    assert.equal(head.body.size, 0);
  });

  it('reports download progress, and works for the other request methods', async () => {
    const seen = [];
    const response = await client().get('/invoice.pdf', { responseType: 'blob', onDownloadProgress: (p) => seen.push(p.loaded) });
    assert.equal(seen.at(-1), PDF.length);
    assert.equal(response.body.size, PDF.length);
    const c = client();
    for (const call of [() => c.post('/invoice.pdf', { body: {}, responseType: 'blob' }), () => c.fetch('/invoice.pdf', { responseType: 'blob' }), () => c.request('GET', '/invoice.pdf', undefined, undefined, { responseType: 'blob' }), () => c.post_json('/invoice.pdf', {}, { responseType: 'blob' })]) {
      assert.equal((await call()).body.type, 'application/pdf');
    }
  });

  it('still rejects error statuses with an HttpError, and leaves other response types alone', async () => {
    const error = await rejection(client().get('/missing', { responseType: 'blob' }));
    assert.deepEqual([error.kind, error.status, error.body], ['HttpError', 404, 'no']);
    assert.ok((await client().get('/invoice.pdf', { responseType: 'binary' })).body instanceof Uint8Array);
  });

  it('works with the mock transport and derived clients', async () => {
    const mock = createMockTransport().onAny({ body: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'image/png' } });
    const c = new WasmClient({ baseUrl: 'https://api.test', transport: mock, retries: 0 }).extend({ timeoutMs: 1000 });
    const response = await c.get('/logo.png', { responseType: 'blob' });
    assert.equal(response.body.type, 'image/png');
    assert.deepEqual(new Uint8Array(await response.body.arrayBuffer()), new Uint8Array([1, 2, 3]));
  });
});
