// The browser build (rust_fetch.js and rust_fetch_bg.wasm) must work under a strict Content Security
// Policy: no eval, no `new Function`, no string timers, no script or HTML injection (#233). This
// reads the shipped glue and fails on the constructs a policy without 'unsafe-eval' or Trusted
// Types would block. Not a browser test: it cannot show a browser accepts the page, only that the
// code asks for none of the things such a policy forbids. The one thing the build does need,
// 'wasm-unsafe-eval' to compile WebAssembly, is stated in docs/security.md.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const pkg = process.env.RUST_FETCH_PKG ? pathToFileURL(`${process.env.RUST_FETCH_PKG}/`).href : new URL('../../pkg/', import.meta.url).href;

/** Source without comments and string/template literal contents, so a word in a message is not a call */
function code(source) {
  let out = '';
  for (let i = 0; i < source.length;) {
    const c = source[i], n = source[i + 1];
    if (c === '/' && n === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = source.indexOf('*/', i + 2); i = i < 0 ? source.length : i + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c; out += quote; i++;
      while (i < source.length && source[i] !== quote) { if (source[i] === '\\') i++; i++; }
      out += quote; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

const FORBIDDEN = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\b|\bFunction\s*\(/, 'the Function constructor'],
  [/\bset(?:Timeout|Interval)\s*\(\s*['"`]/, 'a timer given a string'],
  [/\.(?:innerHTML|outerHTML)\s*=|\binsertAdjacentHTML\b|\bdocument\.write(?:ln)?\b|\bDOMParser\b/, 'HTML injection'],
  [/\bcreateElement\s*\(\s*['"`]script|\bimportScripts\b|\bscript\.src\b/, 'script injection'],
  [/\bimport\s*\(\s*[^'"`\s)]/, 'a dynamic import of a computed specifier'],
  [/\btrustedTypes\b|\bcreatePolicy\b/, 'a Trusted Types policy (none is needed; the build writes no HTML)'],
];

for (const file of ['rust_fetch.js']) {
  it(`${file} asks for nothing a strict Content Security Policy blocks`, () => {
    const source = code(readFileSync(new URL(file, pkg), 'utf8'));
    const found = FORBIDDEN.filter(([pattern]) => pattern.test(source)).map(([, what]) => what);
    assert.deepEqual(found, []);
  });
}

it('the scanner sees what it is meant to see', () => {
  const sample = code('const a = "eval(x)"; // eval(1)\n/* new Function() */ eval(2); el.innerHTML = x;');
  assert.ok(/\beval\s*\(/.test(sample) && /innerHTML\s*=/.test(sample));
  assert.ok(!/eval\(x\)|eval\(1\)|new Function/.test(sample.replace('eval(2)', '')));
});
