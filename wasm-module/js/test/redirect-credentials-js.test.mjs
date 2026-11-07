// The redirect-credentials tests again, without the native addon: the node:http
// transport is what runs where the addon isn't available (#225, #226)
process.env.RUST_FETCH_NATIVE = '0';
await import('./redirect-credentials.test.mjs');
