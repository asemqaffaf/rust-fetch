// Checks the exact package npm will receive, before it's published: packs
// wasm-module/pkg, installs the tarball in an empty directory, and then
//
// 1. checks its contents: the expected files only (no native addon, no
//    stray build output), and the version;
// 2. runs a smoke test against a local server with the installed package;
// 3. runs the security regression suite against the installed package;
// 4. benchmarks it against a published version (default: npm's `latest`),
//    with benchmarks/compare.mjs. With --strict, a regression fails the check.
//
// Usage: node scripts/check-package.mjs [--strict] [--baseline <version>] [--no-bench] [--pkg <dir>]
// Run `npm run build` first (--pkg: a built package elsewhere, default wasm-module/pkg). Used by the release workflow before publishing
// (strict), and on pull requests (informational).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const bench = !args.includes('--no-bench');
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const baseline = option('--baseline', 'latest');

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = resolve(option('--pkg', join(root, 'wasm-module', 'pkg')));
const work = mkdtempSync(join(tmpdir(), 'rust-fetch-package-'));
const run = (command, argv, options = {}) => execFileSync(command, argv, { stdio: 'inherit', ...options });
const output = (command, argv, options = {}) => execFileSync(command, argv, { encoding: 'utf8', ...options });

/** Install `spec` into a new directory under `work`; returns the installed package's directory */
function install(name, spec) {
  const dir = join(work, name);
  run('mkdir', ['-p', dir]);
  run('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' });
  run('npm', ['install', '--no-audit', '--no-fund', '--prefer-online', spec], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  return join(dir, 'node_modules', 'rust-fetch');
}

const step = (title) => console.log(`\n=== ${title}`);

try {
  // --- Pack and install ----------------------------------------------------------
  step('Pack and install the tarball');
  const [packed] = JSON.parse(output('npm', ['pack', '--json', '--pack-destination', work], { cwd: pkgDir }));
  const tarball = join(work, packed.filename);
  const installed = install('package', tarball);
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  console.log(`${packed.filename}: ${packed.size} bytes, ${packed.entryCount} files`);

  // --- Contents ------------------------------------------------------------------
  step('Contents');
  const expected = ['package.json', 'README.md', ...manifest.files].sort();
  const files = packed.files.map((file) => file.path).sort();
  const unexpected = files.filter((file) => !expected.includes(file));
  const missing = expected.filter((file) => !files.includes(file));
  if (unexpected.length || missing.length) {
    throw new Error(`The tarball's files differ from package.json "files": unexpected ${JSON.stringify(unexpected)}, missing ${JSON.stringify(missing)}`);
  }
  const built = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  if (manifest.version !== built) throw new Error(`Installed version ${manifest.version}, built ${built}`);
  if (Object.keys(manifest.dependencies ?? {}).length) throw new Error('The package has runtime dependencies');
  console.log(`rust-fetch@${manifest.version}: ${files.join(', ')}`);

  // --- Smoke test ----------------------------------------------------------------
  step('Smoke test');
  const smoke = `
    import http from 'node:http';
    import { WasmClient } from 'rust-fetch';
    const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const res = await new WasmClient({ timeoutMs: 5000 }).get('http://127.0.0.1:' + server.address().port + '/');
    server.close();
    if (res.status !== 200 || res.body.ok !== true) throw new Error('unexpected response ' + JSON.stringify(res));
    console.log('GET → 200', JSON.stringify(res.body));
  `;
  run(process.execPath, ['--input-type=module', '-e', smoke], { cwd: join(work, 'package') });

  // --- Security regression suite -------------------------------------------------
  step('Security regression suite on the installed package');
  run(process.execPath, ['--test', join(root, 'wasm-module', 'js', 'test', 'security.test.mjs')], {
    env: { ...process.env, RUST_FETCH_PKG: installed },
  });

  // --- Benchmark against the published version -----------------------------------
  if (bench) {
    step(`Benchmark against rust-fetch@${baseline} from npm`);
    const published = install('baseline', `rust-fetch@${baseline}`);
    const version = JSON.parse(readFileSync(join(published, 'package.json'), 'utf8')).version;
    run(process.execPath, [join(root, 'benchmarks', 'compare.mjs'), published, installed], {
      env: {
        ...process.env,
        BENCH_STRICT: strict ? '1' : '0',
        BENCH_TITLE: `Packed rust-fetch@${manifest.version} against rust-fetch@${version} from npm`,
      },
    });
  }
  console.log('\nThe packed package passed every check.');
} finally {
  rmSync(work, { recursive: true, force: true });
}
