// The table of security claims in docs/security.md (#224). Every test it names must still exist,
// and every row needs a status the reader can trust: a claim cannot outlive its evidence.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const doc = readFileSync(`${root}docs/security.md`, 'utf8');
const section = doc.slice(doc.indexOf('## Claims and the tests behind them'));
const rows = section.split('\n').filter((line) => /^\| C\d+ /.test(line)).map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));

it('has a table of claims with an ID, a claim, evidence and a status', () => {
  assert.ok(rows.length >= 20, `${rows.length} rows`);
  assert.deepEqual(rows.map(([id]) => id), rows.map((_, index) => `C${String(index + 1).padStart(2, '0')}`), 'IDs run C01, C02, ... without gaps');
  for (const [id, claim, evidence, status] of rows) {
    assert.ok(claim.length > 10, `${id} has no claim`);
    assert.match(status, /^(tested|partial|process|stated)/, `${id}: status must start with tested, partial, process or stated`);
    if (/^stated/.test(status)) assert.equal(evidence, 'none', `${id}: a stated claim has no evidence`);
    else assert.notEqual(evidence, 'none', `${id}: ${status.split(' ')[0]} needs evidence`);
    if (/^partial/.test(status)) assert.match(status, /: .{10,}/, `${id}: a partial status says what is not covered`);
  }
});

it('every test or check a claim names still exists', () => {
  const missing = [];
  for (const [id, , evidence] of rows) {
    for (const [, path, text] of evidence.matchAll(/`([^`:]+\.(?:mjs|js|yml|rs))::([^`]+)`/g)) {
      const file = `${root}${path}`;
      if (!existsSync(file)) missing.push(`${id}: ${path} does not exist`);
      else if (!readFileSync(file, 'utf8').includes(text)) missing.push(`${id}: "${text}" is not in ${path}`);
    }
  }
  assert.deepEqual(missing, []);
});

it('the claims that were reworded because nothing tests them say so', () => {
  const security = readFileSync(`${root}SECURITY.md`, 'utf8');
  assert.match(security, /by design, not yet tested across threads/);
  assert.match(security, /#238 and #239/);
});

it('every claim is placed in the threat model, and every ID the threat model uses is a claim', () => {
  const model = readFileSync(`${root}docs/threat-model.md`, 'utf8');
  const claimIds = rows.map(([id]) => id);
  const used = new Set(model.match(/\bC\d{2}\b/g) ?? []);
  assert.deepEqual(claimIds.filter((id) => !used.has(id)), [], 'claims the threat model never mentions');
  assert.deepEqual([...used].filter((id) => !claimIds.includes(id)), [], 'IDs in the threat model that are not claims');
});
