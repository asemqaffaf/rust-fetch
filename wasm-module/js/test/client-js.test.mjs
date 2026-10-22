// The client tests again, without the native addon: the node:http transport
// is what runs where the addon isn't available
process.env.RUST_FETCH_NATIVE = '0';
await import('./client.test.mjs');
