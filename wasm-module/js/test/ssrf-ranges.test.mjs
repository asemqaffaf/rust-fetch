// allowPrivateNetwork: false against the IANA special-purpose address registries
// (https://www.iana.org/assignments/iana-ipv4-special-registry and
// https://www.iana.org/assignments/iana-ipv6-special-registry), #225.
//
// Every block the registries list as not globally reachable is tried at its
// first, a middle and its last address, and the addresses just outside it must
// be let through. The address check is the one `websocket()` uses, so nothing
// connects. A range that is missing from the guard fails here by name.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const pkg = process.env.RUST_FETCH_PKG ? pathToFileURL(`${process.env.RUST_FETCH_PKG}/`).href : new URL('../../pkg/', import.meta.url).href;
await import(new URL('node.js', pkg).href);
const guard = globalThis[Symbol.for('rust-fetch.websocketGuard')];

/** blocked / not blocked, from what the guard throws for `host` */
function verdict(host) {
  const url = `ws://${net.isIPv6(host) ? `[${host}]` : host}/`;
  try {
    guard(url);
    return 'not blocked';
  } catch (error) {
    return error.code === 'RUST_FETCH_BLOCKED' ? 'blocked' : `error ${error.code ?? error.message}`;
  }
}

// [block, what the registry calls it]
const IPV4 = [
  ['0.0.0.0/8', 'this network'],
  ['10.0.0.0/8', 'private-use'],
  ['100.64.0.0/10', 'shared address space'],
  ['127.0.0.0/8', 'loopback'],
  ['169.254.0.0/16', 'link-local'],
  ['172.16.0.0/12', 'private-use'],
  ['192.0.0.0/24', 'IETF protocol assignments'],
  ['192.0.2.0/24', 'documentation (TEST-NET-1)'],
  ['192.168.0.0/16', 'private-use'],
  ['198.18.0.0/15', 'benchmarking'],
  ['198.51.100.0/24', 'documentation (TEST-NET-2)'],
  ['203.0.113.0/24', 'documentation (TEST-NET-3)'],
  ['224.0.0.0/4', 'multicast'],
  ['240.0.0.0/4', 'reserved, and limited broadcast'],
];

const IPV6 = [
  ['::/128', 'unspecified'],
  ['::1/128', 'loopback'],
  ['64:ff9b:1::/48', 'local-use IPv4/IPv6 translation'],
  ['100::/64', 'discard-only'],
  ['100:0:0:1::/64', 'dummy IPv6 prefix'],
  ['2001:2::/48', 'benchmarking'],
  ['2001:10::/28', 'ORCHID (deprecated)'],
  ['2001:db8::/32', 'documentation'],
  ['3fff::/20', 'documentation'],
  ['5f00::/16', 'segment routing SIDs'],
  ['fc00::/7', 'unique local'],
  ['fe80::/10', 'link-local unicast'],
  ['fec0::/10', 'site-local (deprecated)'],
  ['ff00::/8', 'multicast'],
];

const toBigInt = (address) => {
  if (net.isIPv4(address)) return address.split('.').reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
  const [head, tail] = address.split('::');
  const groups = (part) => (part ? part.split(':') : []);
  const first = groups(head);
  const last = tail === undefined ? [] : groups(tail);
  const all = tail === undefined ? first : [...first, ...new Array(8 - first.length - last.length).fill('0'), ...last];
  return all.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
};
const toAddress = (value, family) => {
  if (family === 4) return [24n, 16n, 8n, 0n].map((shift) => (value >> shift) & 0xffn).join('.');
  return Array.from({ length: 8 }, (_, index) => ((value >> BigInt((7 - index) * 16)) & 0xffffn).toString(16)).join(':');
};

/** First, middle and last address of a block, and the address before and after it */
function probes(block, family) {
  const [base, prefix] = block.split('/');
  const bits = family === 4 ? 32n : 128n;
  const size = 1n << (bits - BigInt(prefix));
  const first = toBigInt(base);
  const last = first + size - 1n;
  const limit = (1n << bits) - 1n;
  return {
    inside: [first, first + size / 2n, last].map((value) => toAddress(value, family)),
    before: first > 0n ? toAddress(first - 1n, family) : undefined,
    after: last < limit ? toAddress(last + 1n, family) : undefined,
  };
}

describe('allowPrivateNetwork: false covers the IANA special-purpose registries', () => {
  for (const [family, table] of [[4, IPV4], [6, IPV6]]) {
    for (const [block, name] of table) {
      it(`blocks IPv${family} ${block} (${name})`, () => {
        for (const address of probes(block, family).inside) assert.equal(verdict(address), 'blocked', `${address} in ${block}`);
      });
    }
  }

  it('lets through the addresses just outside the IPv4 blocks that are not adjacent to another block', () => {
    const blocks = IPV4.map(([block]) => block);
    const inAnyBlock = (address) => blocks.some((block) => {
      const [base, prefix] = block.split('/');
      const size = 1n << (32n - BigInt(prefix));
      const value = toBigInt(address);
      return value >= toBigInt(base) && value < toBigInt(base) + size;
    });
    for (const block of blocks) {
      const { before, after } = probes(block, 4);
      for (const address of [before, after].filter(Boolean)) {
        if (!inAnyBlock(address)) assert.equal(verdict(address), 'not blocked', `${address} next to ${block}`);
      }
    }
  });

  it('lets through public IPv4 and IPv6 addresses', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '9.9.9.9', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '192.0.1.1', '192.169.0.1', '198.17.255.255', '198.20.0.1', '223.255.255.255',
      '2606:4700:4700::1111', '2001:4860:4860::8888', '2001:1::1', '2001:3::1', '2000::1', '2001:4:112::1', '2620:4f:8000::1']) {
      assert.equal(verdict(address), 'not blocked', address);
    }
  });

  it('blocks IPv4-mapped, translated and tunnelled forms that carry a private IPv4 address, and only those', () => {
    const private4 = [['10.0.0.1', 'a00:1'], ['127.0.0.1', '7f00:1'], ['169.254.169.254', 'a9fe:a9fe'], ['192.168.1.1', 'c0a8:101'], ['100.64.0.1', '6440:1']];
    for (const [dotted, hex] of private4) {
      for (const form of [`::ffff:${dotted}`, `::ffff:${hex}`, `::ffff:0:${hex}`, `64:ff9b::${hex}`, `2002:${hex}::1`]) {
        assert.equal(verdict(form), 'blocked', form);
      }
    }
    for (const form of ['::ffff:808:808', '::ffff:0:808:808', '64:ff9b::808:808', '2002:808:808::1', '2001:0:808:808:0:0:f7f7:f7f7']) {
      assert.equal(verdict(form), 'not blocked', form);
    }
    // Teredo: a private server or a private (obfuscated) client address
    assert.equal(verdict('2001:0:7f00:1::1'), 'blocked', 'Teredo with a loopback server');
    assert.equal(verdict('2001:0:808:808:0:0:f5ff:fffe'), 'blocked', 'Teredo with client 10.0.0.1');
  });
});

describe('allowPrivateNetwork: false checks every address a name resolves to', async () => {
  const { default: dns } = await import('node:dns');
  const { WasmClient } = await import(new URL('node.js', pkg).href);
  const original = dns.lookup;
  const answers = new Map();
  const asked = [];
  // A resolver the test controls; names it does not know go to the real one
  dns.lookup = (hostname, options, callback) => {
    if (!answers.has(hostname)) return original(hostname, options, callback);
    asked.push(hostname);
    const entries = answers.get(hostname);
    queueMicrotask(() => (options?.all ? callback(null, entries.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 }))) : callback(null, entries[0], net.isIPv6(entries[0]) ? 6 : 4)));
  };
  const client = new WasmClient({ allowPrivateNetwork: false, retries: 0, timeoutMs: 2000 });
  const blocked = (name) => client.get(`http://${name}:9/`).then(() => 'reached', (error) => (/Blocked: /.test(error.message) ? 'blocked' : `other: ${error.message}`));

  for (const [name, list] of Object.entries({
    'private-only.test': ['10.0.0.1'],
    'public-then-private.test': ['1.1.1.1', '10.0.0.1'],
    'private-then-public.test': ['10.0.0.1', '1.1.1.1'],
    'public-and-mapped-private.test': ['1.1.1.1', '::ffff:10.0.0.1'],
    'public-and-metadata.test': ['8.8.8.8', '2606:4700:4700::1111', '169.254.169.254'],
    'public-and-benchmarking.test': ['1.1.1.1', '2001:2::1'],
  })) {
    it(`refuses ${name}: ${list.join(', ')}`, async () => {
      answers.set(name, list);
      assert.equal(await blocked(name), 'blocked');
    });
  }

  it('asks the resolver again for every request, so a changed answer is caught', async () => {
    // DNS rebinding: the first answer is harmless in a check made once, and the next is not.
    answers.set('rebind.test', ['10.0.0.1']);
    asked.length = 0;
    assert.equal(await blocked('rebind.test'), 'blocked');
    assert.equal(await blocked('rebind.test'), 'blocked');
    assert.ok(asked.filter((name) => name === 'rebind.test').length >= 2, `resolver was asked ${asked.length} time(s)`);
  });

  it('puts the original resolver back', () => {
    dns.lookup = original;
    assert.equal(dns.lookup, original);
  });
});
