// client.paginate() (#44): Link headers, cursors, items, early break, errors, limits.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import init, { WasmClient } from '../../pkg/node.js';
import { json, rejection, startServer } from './helpers.mjs';

let server, other;
const hits = [];
before(async () => {
  await init();
  other = await startServer((req, res) => json(res, [999]));
  server = await startServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    hits.push(req.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const items = [page * 10 + 1, page * 10 + 2];
    switch (url.pathname) {
      case '/relative': // 3 pages
        res.setHeader('link', page < 3 ? `</relative?page=${page + 1}>; rel="next", </relative?page=3>; rel="last"` : '</relative?page=1>; rel="first"');
        return json(res, items);
      case '/absolute':
        res.setHeader('link', page < 2 ? `<http://${req.headers.host}/absolute?page=${page + 1}&a=1,2>; title="x, y"; rel="next prev"` : '');
        return json(res, items);
      case '/cursor': {
        const cursor = url.searchParams.get('cursor');
        const n = cursor ? Number(cursor) : 0;
        return json(res, { items: [n, n + 1], nextCursor: n < 4 ? String(n + 2) : null });
      }
      case '/boom':
        if (page === 3) return json(res, {}, { status: 500 });
        res.setHeader('link', `</boom?page=${page + 1}>; rel=next`);
        return json(res, items);
      case '/loop':
        res.setHeader('link', '</loop?page=1>; rel="next"');
        return json(res, items);
      case '/away':
        res.setHeader('link', `<${other.url('/x')}>; rel="next"`);
        return json(res, items);
      default:
        return json(res, items);
    }
  });
});
after(async () => { await server.close(); await other.close(); });

const client = () => new WasmClient({ baseUrl: server.url('').replace(/\/$/, ''), retries: 0 });
const collect = async (iterator) => { const out = []; for await (const value of iterator) out.push(value); return out; };

describe('client.paginate()', () => {
  it('yields pages and follows relative Link headers', async () => {
    hits.length = 0;
    const pages = await collect(client().paginate('/relative'));
    assert.deepEqual(pages.map((p) => p.body), [[11, 12], [21, 22], [31, 32]]);
    assert.deepEqual(hits, ['/relative', '/relative?page=2', '/relative?page=3']);
  });

  it('yields items, follows absolute Link URLs and reads rel="next" among several relations', async () => {
    const all = await collect(client().paginate('/absolute', { items: (r) => r.body }));
    assert.deepEqual(all, [11, 12, 21, 22]);
    assert.ok(hits.includes('/absolute?page=2&a=1%2C2') || hits.includes('/absolute?page=2&a=1,2'));
  });

  it('follows a cursor the app extracts, merging params and keeping the other request options', async () => {
    hits.length = 0;
    const items = await collect(client().paginate('/cursor', {
      params: { limit: 2 },
      headers: { 'x-trace': 'abc' },
      items: (r) => r.body.items,
      next: (r) => r.body.nextCursor && { params: { cursor: r.body.nextCursor } },
    }));
    assert.deepEqual(items, [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(hits, ['/cursor?limit=2', '/cursor?limit=2&cursor=2', '/cursor?limit=2&cursor=4']);
  });

  it('stops at once on break: no further page is requested', async () => {
    hits.length = 0;
    for await (const item of client().paginate('/relative', { items: (r) => r.body })) {
      if (item === 12) break;
    }
    assert.deepEqual(hits, ['/relative']);
  });

  it('honours maxPages', async () => {
    const pages = await collect(client().paginate('/relative', { maxPages: 2 }));
    assert.equal(pages.length, 2);
  });

  it('stops when a server links back to a page it already sent', async () => {
    hits.length = 0;
    const pages = await collect(client().paginate('/loop', { maxPages: 50 }));
    assert.ok(pages.length <= 3, `${pages.length} pages`);
  });

  it('rejects mid-iteration with the page error, after yielding the earlier pages', async () => {
    const seen = [];
    const error = await rejection((async () => { for await (const page of client().paginate('/boom')) seen.push(page.body); })());
    assert.deepEqual(seen, [[11, 12], [21, 22]]);
    assert.deepEqual([error.kind, error.status], ['HttpError', 500]);
  });

  it('does not follow a next URL to another origin unless told to', async () => {
    const error = await rejection(collect(client().paginate('/away')));
    assert.deepEqual([error.kind, error.parameter], ['InvalidInputError', 'next']);
    assert.match(error.message, /another origin/);
    const items = await collect(client().paginate('/away', { crossOrigin: true, items: (r) => r.body }));
    assert.deepEqual(items, [11, 12, 999]);
  });

  it('cancels with the signal', async () => {
    const controller = new AbortController();
    const iterator = client().paginate('/relative', { signal: controller.signal });
    await iterator.next();
    controller.abort('stop');
    const error = await rejection(iterator.next());
    assert.deepEqual([error.kind, error.reason], ['CancelledError', 'stop']);
  });

  it('validates its options when iteration starts', async () => {
    for (const [options, parameter] of [['x', 'options'], [{ items: 1 }, 'items'], [{ next: 'no' }, 'next'], [{ maxPages: 0 }, 'maxPages'], [{ maxPages: 1.5 }, 'maxPages'], [{ next: () => 5 }, 'next']]) {
      const error = await rejection(collect(client().paginate('/relative', options)));
      assert.deepEqual([error.kind, error.parameter], ['InvalidInputError', parameter], JSON.stringify(options));
    }
  });

  it('works on a derived client', async () => {
    const pages = await collect(client().extend({ headers: { 'x-d': '1' } }).paginate('/relative'));
    assert.equal(pages.length, 3);
  });
});
