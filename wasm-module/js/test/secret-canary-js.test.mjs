// The secret-leak canary tests again, without the native addon: the node:http
// transport is what runs where the addon isn't available (#227)
process.env.RUST_FETCH_NATIVE = '0';
await import('./secret-canary.test.mjs');
