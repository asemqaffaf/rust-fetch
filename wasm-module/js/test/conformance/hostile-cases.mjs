// Hostile and malformed server responses on every adapter (#228). The same raw bytes are sent to each;
// what each adapter does is in the matrix. Never a hang, never a body longer than the server declared.
// The text read, or the typed error; an adapter that reads bytes is decoded so they compare
const get = (name) => `async (rf, ctx) => {
  const r = await outcome(new WasmClient({ timeoutMs: 1500, retries: 0 }).get(ctx.a + '/fault/framing?case=${name}'));
  return r.error ? { error: r.error } : { status: r.status, body: typeof r.body === 'string' ? r.body : new TextDecoder().decode(r.body) };
}`;
const rejected = { error: 'NetworkError' };
const read = { status: 200, body: 'ok' };
const NATIVE = "the native addon's parser (hyper) reads a response it can frame without ambiguity: bare LF line endings, and Content-Length together with Transfer-Encoding (chunked wins, and the connection is closed afterwards instead of reused, #243)";
const BROWSER = 'browsers parse the response themselves and are lenient: they read bare LF, obsolete line folding, a space before the header colon, and Content-Length together with Transfer-Encoding; rust-fetch\'s own parser does not run in a browser';
const UNDICI = "fetch() in Node.js (undici) reads obsolete line folding and chunk data that is not followed by CRLF";
const FIREFOX = 'Firefox treats a response that is not HTTP, or has an unknown HTTP version, as an HTTP/0.9 body and hands the raw bytes to the page';
const NODE = 'node:http rejects the response when bytes follow the declared Content-Length, where the others read the declared length and drop the rest';
const only = (adapters, expect, why) => Object.fromEntries(adapters.map((adapter) => [adapter, { expect, why }]));
const browsers = ['chromium', 'firefox', 'webkit'];
const differences = {
  'framing-content-length-with-transfer-encoding': { ...only(['native'], read, NATIVE), ...only(browsers, read, BROWSER) },
  'framing-chunk-without-crlf': only(['fetch()'], read, UNDICI),
  'framing-bare-lf': { ...only(['native'], read, NATIVE), ...only(browsers, read, BROWSER) },
  'framing-obsolete-line-folding': { ...only(['fetch()'], read, UNDICI), ...only(browsers, read, BROWSER) },
  'framing-space-before-colon': only(browsers, read, BROWSER),
  'framing-not-http': only(['firefox'], { status: 200, body: 'this is not http\r\n\r\n' }, FIREFOX),
  'framing-unknown-http-version': { chromium: { expect: read, why: BROWSER }, firefox: { expect: { status: 200, body: 'HTTP/9.9 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 2\r\n\r\nok' }, why: FIREFOX } },
  'framing-bytes-after-the-length': only(['node:http'], rejected, NODE),
};

export const hostileCases = [
  { id: 'framing-well-formed', title: 'A well-formed raw response is read (control)', run: get('well-formed'), expect: { status: 200, body: 'ok' } },
  ...[
    ['conflicting-content-length', 'Conflicting Content-Length values are rejected'],
    ['content-length-with-transfer-encoding', 'Content-Length together with Transfer-Encoding is rejected'],
    ['bad-chunk-size', 'A chunk size that is not hexadecimal is rejected'],
    ['chunk-without-crlf', 'Chunk data not followed by CRLF is rejected'],
    ['bare-lf', 'Bare LF line endings are rejected'],
    ['obsolete-line-folding', 'Obsolete line folding is rejected'],
    ['space-before-colon', 'A space before the header colon is rejected'],
    ['not-http', 'A response that is not HTTP is rejected'],
    ['unknown-http-version', 'An unknown HTTP version is rejected'],
    ['body-shorter-than-length', 'A body shorter than its Content-Length is rejected'],
  ].map(([name, title]) => ({ id: `framing-${name}`, title, run: get(name), expect: rejected })),
  { id: 'framing-bytes-after-the-length', title: 'Bytes after the declared length never reach the caller', run: get('bytes-after-the-length'), expect: { status: 200, body: 'first' } },
].map((testCase) => ({ area: 'Hostile responses', ...testCase, ...(differences[testCase.id] ? { differs: differences[testCase.id] } : {}) }));
