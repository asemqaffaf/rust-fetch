// After `vitepress build`: every internal link with a #fragment must point at
// an id on its page (VitePress checks pages, not anchors), and every link the
// README makes into the site must exist, page and anchor.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const docs = new URL('..', import.meta.url).pathname;
const dist = join(docs, '.vitepress/dist');
const SITE = 'https://asemqaffaf.github.io/rust-fetch/';

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith('.html')) files.push(path);
  }
};
walk(dist);
const pageOf = (file) => '/rust-fetch/' + relative(dist, file).replace(/index\.html$/, '').replace(/\.html$/, '');
const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decodeURIComponent(m[1])));
const ids = new Map(files.map((file) => [pageOf(file), idsOf(readFileSync(file, 'utf8'))]));

const broken = [];
let checked = 0;
for (const file of files) {
  const from = pageOf(file);
  for (const [, href] of readFileSync(file, 'utf8').matchAll(/href="([^"]*#[^"]+)"/g)) {
    if (/^[a-z]+:/.test(href)) continue; // external
    const [path, fragment] = href.split('#');
    const page = path === '' ? from : path.replace(/\.html$/, '');
    if (!ids.has(page)) continue; // an asset, not a page
    checked++;
    if (!ids.get(page).has(decodeURIComponent(fragment))) broken.push(`${from} → ${href}`);
  }
}

const readme = readFileSync(join(docs, '../README.md'), 'utf8');
for (const [, url] of readme.matchAll(/\]\((https:\/\/asemqaffaf\.github\.io\/rust-fetch\/[^)]*)\)/g)) {
  const [path, fragment] = url.slice(SITE.length).split('#');
  const page = '/rust-fetch/' + path;
  checked++;
  if (!ids.has(page)) broken.push(`README → ${url}: no such page`);
  else if (fragment && !ids.get(page).has(fragment)) broken.push(`README → ${url}: no such anchor`);
}

if (broken.length) {
  console.error(`${broken.length} broken link(s):\n  ${broken.join('\n  ')}`);
  process.exit(1);
}
console.log(`${checked} links checked (site anchors and the README's links into the site), none broken`);

