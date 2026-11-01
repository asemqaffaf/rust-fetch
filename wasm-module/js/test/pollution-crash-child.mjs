// Runs in a child process with no error handlers at all, so that a polluted
// Object.prototype that makes the client throw outside a request (and would
// take an application down) ends this process with a failure. Streaming
// uploads keep records and sessions whose optional fields were once read
// from the prototype chain.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { WasmClient } = await import(process.env.POLLUTION_PKG);
const servers = fork(fileURLToPath(new URL('./pollution-servers.mjs', import.meta.url)));
const ports = await new Promise((resolve) => servers.once('message', resolve));
const url = `http://127.0.0.1:${ports.target}/json`;

const names = ['upload', 'reader', 'pending', 'cancelled', 'claimed', 'failure', 'web', 'source', 'restart', 'factory', 'replayable', 'open',
  'report', 'next', 'cancel', 'done', 'loaded', 'used', 'data', 'end', 'error', 'invalidInput', 'cause', 'phases', 'waiting', 'nativeNext'];
const values = [true, 1, 'x', {}, ['x'], () => {}, { done: true }, { open() { throw new Error('captured'); } }];
const body = () => new ReadableStream({
  __proto__: null,
  start(controller) { controller.enqueue(new Uint8Array(1000)); controller.enqueue(new Uint8Array(500)); controller.close(); },
  pull: undefined, cancel: undefined, type: undefined, autoAllocateChunkSize: undefined,
}, { __proto__: null, highWaterMark: undefined, size: undefined });

let requests = 0;
for (const name of names) {
  for (const value of values) {
    Object.defineProperty(Object.prototype, name, { configurable: true, writable: true, enumerable: false, value });
    let sizes;
    try {
      const client = new WasmClient({ retries: 0 });
      const streamed = await client.post(url, { body });
      const plain = await client.post(url, { body: 'hello' });
      const timed = await new WasmClient({ retries: 0, timings: true }).get(url);
      sizes = [streamed.body.size, plain.body.size, timed.status];
    } finally {
      delete Object.prototype[name];
    }
    if (sizes.join() !== '1500,5,200') throw new Error(`${name} changed the requests: ${sizes}`);
    requests += 3;
  }
}
servers.kill();
console.log(JSON.stringify({ requests }));
process.exit(0);
