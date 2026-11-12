// Shared helpers for the JavaScript client wrapper layers appended by scripts/postbuild.mjs.
const optionsArgIndex = (name) => (name === 'request' ? 4 : name.endsWith('_json') ? 2 : 1);
