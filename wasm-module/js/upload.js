// Portable byte transport, appended to the generated browser/Node glue by
// postbuild. Retry decisions stay in Rust; an owner only opens a body source.
(() => {
  const ignore = () => {};
  const MAX_CHUNK = 64 * 1024;
  const usedSources = new WeakSet();
  let encoder;
  let supported;
  const invalid = (message) => Object.assign(new TypeError(message), {
    kind: 'InvalidInputError', parameter: 'body', code: 'RUST_FETCH_UPLOAD_INPUT',
  });
  const isSource = (value) => value != null &&
    (typeof value.getReader === 'function' || typeof value[Symbol.asyncIterator] === 'function');
  const bytes = (value) => {
    if (typeof value === 'string') return (encoder ??= new TextEncoder()).encode(value);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw invalid('A streaming request body must produce byte arrays or strings');
  };
  function cancel(record) {
    if (record.cancelled) return;
    record.cancelled = true;
    const finished = record.done;
    record.done = true;
    if (record.source && !record.claimed && !finished) {
      if (usedSources.has(record.source)) record.source = undefined;
      else usedSources.add(record.source);
    }
    try {
      if (record.reader && !finished) {
        const pending = record.web ? record.reader.cancel() : record.reader.return?.();
        Promise.resolve(pending).catch(ignore);
        if (record.web) record.reader.releaseLock();
      }
      if (!finished && !record.reader && typeof record.source?.cancel === 'function') Promise.resolve(record.source.cancel()).catch(ignore);
      if (!finished) record.source?.destroy?.(); // Node Readable: interrupt a pending read too.
    } catch { /* Cancellation preserves the request's original error. */ }
    record.pending = undefined;
  }
  function open(owner, progress, length) {
    if (length != null && (!/^(0|[1-9][0-9]*)$/.test(String(length)) || !Number.isSafeInteger(Number(length)))) throw invalid('Content-Length must be a nonnegative safe integer for a streaming body');
    const total = length == null ? 0 : Number(length);
    const expected = length == null ? undefined : total;
    let record = { loaded: 0, done: false, source: owner.factory ? undefined : owner.source };
    const report = (current) => {
      if (progress && !current.cancelled) try { progress({ loaded: current.loaded, total }); } catch {}
    };
    async function read() {
      const current = record;
      try {
        if (current.done) return { done: true };
        if (!current.reader) {
          const source = owner.factory ? await owner.factory() : owner.source;
          if (!isSource(source)) throw invalid('A body factory must return a ReadableStream or async iterable');
          if (usedSources.has(source)) throw invalid('A streaming request body can only be sent once; provide a body factory to replay it');
          usedSources.add(source);
          owner.used = true;
          current.claimed = true;
          current.source = source;
          current.web = typeof source.getReader === 'function';
          if (current.web && source.locked) throw invalid('The streaming body is already locked');
          current.reader = current.web ? source.getReader() : source[Symbol.asyncIterator]();
          if (current.done) { current.done = false; current.cancelled = false; cancel(current); return { done: true }; }
        }
        let data = current.pending;
        while (!data?.byteLength) {
          const step = await (current.web ? current.reader.read() : current.reader.next());
          if (current.done) return { done: true };
          if (step.done) {
            if (expected !== undefined && current.loaded !== expected) throw invalid('Streaming body length does not match Content-Length');
            current.done = true;
            if (current.web) current.reader.releaseLock();
            return { done: true };
          }
          data = bytes(step.value);
        }
        let chunk = data.subarray(0, MAX_CHUNK);
        current.pending = data.byteLength > MAX_CHUNK ? data.subarray(MAX_CHUNK) : undefined;
        if (expected !== undefined && current.loaded + chunk.byteLength > expected) throw invalid('Streaming body exceeds Content-Length');
        current.loaded += chunk.byteLength;
        if (expected !== undefined && current.loaded === expected) {
          if (current.pending?.byteLength) throw invalid('Streaming body exceeds Content-Length');
          chunk = chunk.slice();
          for (;;) {
            const step = await (current.web ? current.reader.read() : current.reader.next());
            if (current.cancelled) return { done: true };
            if (step.done) break;
            if (bytes(step.value).byteLength) throw invalid('Streaming body exceeds Content-Length');
          }
          current.done = true;
          if (current.web) current.reader.releaseLock();
        }
        return { done: false, data: chunk, end: current.done };
      } catch (cause) {
        const cancelled = current.cancelled;
        cancel(current);
        if (cancelled) return { done: true };
        return current.failure = { done: true, error: cause?.message ?? String(cause), invalidInput: cause?.code === 'RUST_FETCH_UPLOAD_INPUT', cause };
      }
    }
    const session = {
      next: read,
      failure: () => record.failure,
      cancel: () => cancel(record),
      async nativeNext() {
        const step = await read();
        if (step.data) {
          // Native code consumes the result on another thread. Own a copy
          // rather than racing a producer that reuses its original buffer.
          step.data = step.data.slice();
        }
        return step;
      },
      report: (loaded) => { if (progress && !record.cancelled) try { progress({ loaded, total }); } catch {} },
      readable() {
        return new ReadableStream({
          async pull(controller) {
            const current = record;
            const step = await read();
            if (current.cancelled && step.error === undefined) return;
            if (step.error !== undefined) controller.error(Object.assign(new Error(step.error), {
              code: step.invalidInput ? 'RUST_FETCH_UPLOAD_INPUT' : 'RUST_FETCH_UPLOAD_ERROR', cause: step.cause,
            }));
            else if (step.done) controller.close();
            else { controller.enqueue(step.data); report(current); }
          },
          cancel: () => cancel(record),
        }, { highWaterMark: 0 });
      },
    };
    if (owner.factory) session.restart = () => { cancel(record); record = { loaded: 0, done: false }; };
    return session;
  }
  function create(source) {
    const factory = typeof source === 'function' ? source : undefined;
    if (!factory && !isSource(source)) return undefined;
    const owner = { source, factory, used: false };
    const result = {
      replayable: !!factory,
      open: (progress, length) => open(owner, progress ?? result.progress, length),
      cancel: () => { if (!owner.used && !factory) cancel({ source, done: false }); },
    };
    return result;
  }
  create.supported = () => {
    if (supported !== undefined) return supported;
    let duplex = false;
    try {
      const request = new Request('https://rust-fetch.invalid/', {
        method: 'POST', body: new ReadableStream({ start(c) { c.close(); } }),
        get duplex() { duplex = true; return 'half'; },
      });
      supported = duplex && !request.headers.has('Content-Type');
    } catch { supported = false; }
    return supported;
  };
  globalThis[Symbol.for('rust-fetch.upload')] = create;
})();
