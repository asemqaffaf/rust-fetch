// Portable byte transport, appended to the generated browser/Node glue by
// postbuild. Retry decisions stay in Rust; an owner only opens a body source.
(() => {
  const ignore = () => {}, MAX_CHUNK = 64 * 1024, usedSources = new WeakSet();
  let supported;
  const invalid = (m) => Object.assign(new TypeError(m), { kind: 'InvalidInputError', parameter: 'body', code: 'RUST_FETCH_UPLOAD_INPUT' });
  const isSource = (v) => v != null && (typeof v.getReader === 'function' || typeof v[Symbol.asyncIterator] === 'function');
  const bytes = (v) => {
    if (typeof v === 'string') return encodeUtf8(v);
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    throw invalid('A streaming request body must produce byte arrays or strings');
  };
  // Record array: [0:loaded, 1:done, 2:cancelled, 3:claimed, 4:web, 5:source, 6:reader, 7:pending, 8:failure]
  const mkRec = (src) => [0, false, false, false, false, src, undefined, undefined, undefined];
  function cancelRec(r) {
    if (r[2]) return;
    r[2] = true;
    const fin = r[1];
    r[1] = true;
    if (r[5] && !r[3] && !fin) {
      if (usedSources.has(r[5])) r[5] = undefined;
      else usedSources.add(r[5]);
    }
    try {
      if (r[6] && !fin) {
        Promise.resolve(r[4] ? r[6].cancel() : r[6].return?.()).catch(ignore);
        if (r[4]) r[6].releaseLock();
      }
      if (!fin && !r[6] && typeof r[5]?.cancel === 'function') Promise.resolve(r[5].cancel()).catch(ignore);
      if (!fin) r[5]?.destroy?.();
    } catch {}
    r[7] = undefined;
  }
  function open(owner, progress, length) {
    if (length != null && (!/^(0|[1-9][0-9]*)$/.test(String(length)) || !Number.isSafeInteger(Number(length)))) {
      throw invalid('Content-Length must be a nonnegative safe integer for a streaming body');
    }
    const total = length == null ? 0 : Number(length), expected = length == null ? undefined : total;
    let rec = mkRec(owner[1] ? undefined : owner[0]);
    const report = (r) => { if (progress && !r[2]) try { progress({ loaded: r[0], total }); } catch {} };
    async function read() {
      const r = rec;
      try {
        if (r[1]) return { __proto__: null, done: true };
        if (!r[6]) {
          const src = owner[1] ? await owner[1]() : owner[0];
          if (!isSource(src)) throw invalid('A body factory must return a ReadableStream or async iterable');
          if (usedSources.has(src)) throw invalid('A streaming request body can only be sent once; provide a body factory to replay it');
          usedSources.add(src);
          owner[2] = true;
          r[3] = true;
          r[5] = src;
          r[4] = typeof src.getReader === 'function';
          if (r[4] && src.locked) throw invalid('The streaming body is already locked');
          r[6] = r[4] ? src.getReader() : src[Symbol.asyncIterator]();
          if (r[1]) { r[1] = r[2] = false; cancelRec(r); return { __proto__: null, done: true }; }
        }
        let data = r[7];
        while (!data?.byteLength) {
          const step = await (r[4] ? r[6].read() : r[6].next());
          if (r[1]) return { __proto__: null, done: true };
          if (step.done) {
            if (expected !== undefined && r[0] !== expected) throw invalid('Streaming body length does not match Content-Length');
            r[1] = true;
            if (r[4]) r[6].releaseLock();
            return { __proto__: null, done: true };
          }
          data = bytes(step.value);
        }
        let chunk = data.subarray(0, MAX_CHUNK);
        r[7] = data.byteLength > MAX_CHUNK ? data.subarray(MAX_CHUNK) : undefined;
        if (expected !== undefined && r[0] + chunk.byteLength > expected) throw invalid('Streaming body exceeds Content-Length');
        r[0] += chunk.byteLength;
        if (expected !== undefined && r[0] === expected) {
          if (r[7]?.byteLength) throw invalid('Streaming body exceeds Content-Length');
          chunk = chunk.slice();
          for (;;) {
            const step = await (r[4] ? r[6].read() : r[6].next());
            if (r[2]) return { __proto__: null, done: true };
            if (step.done) break;
            if (bytes(step.value).byteLength) throw invalid('Streaming body exceeds Content-Length');
          }
          r[1] = true;
          if (r[4]) r[6].releaseLock();
        }
        return { __proto__: null, done: false, data: chunk, end: r[1] };
      } catch (cause) {
        const wasCancelled = r[2];
        cancelRec(r);
        if (wasCancelled) return { __proto__: null, done: true };
        return r[8] = { __proto__: null, done: true, error: errMsg(cause), invalidInput: cause?.code === 'RUST_FETCH_UPLOAD_INPUT', cause };
      }
    }
    const session = {
      __proto__: null,
      next: read,
      failure: () => rec[8],
      cancel: () => cancelRec(rec),
      async nativeNext() { const step = await read(); if (step.data) step.data = step.data.slice(); return step; },
      report: (loaded) => { if (progress && !rec[2]) try { progress({ loaded, total }); } catch {} },
      readable() {
        return safeStream({
          async pull(controller) {
            const r = rec, step = await read();
            if (r[2] && step.error === undefined) return;
            if (step.error !== undefined) controller.error(Object.assign(new Error(step.error), { code: step.invalidInput ? 'RUST_FETCH_UPLOAD_INPUT' : 'RUST_FETCH_UPLOAD_ERROR', cause: step.cause }));
            else if (step.done) controller.close();
            else { controller.enqueue(step.data); report(r); }
          },
          cancel: () => cancelRec(rec),
        }, 0);
      },
    };
    if (owner[1]) session.restart = () => { cancelRec(rec); rec = mkRec(undefined); };
    return session;
  }
  function create(source) {
    const factory = typeof source === 'function' ? source : undefined;
    if (!factory && !isSource(source)) return undefined;
    const owner = [source, factory, false];
    const result = {
      __proto__: null,
      replayable: !!factory,
      open: (progress, length) => open(owner, progress ?? result.progress, length),
      cancel: () => { if (!owner[2] && !factory) cancelRec(mkRec(source)); },
    };
    return result;
  }
  create.supported = () => {
    if (supported !== undefined) return supported;
    let duplex = false;
    try {
      const req = new Request('https://rust-fetch.invalid/', {
        __proto__: null, method: 'POST',
        body: safeStream({ start(c) { c.close(); }, pull: undefined, cancel: undefined }),
        get duplex() { duplex = true; return 'half'; },
      });
      supported = duplex && !req.headers.has('Content-Type');
    } catch { supported = false; }
    return supported;
  };
  globalThis[Symbol.for('rust-fetch.upload')] = create;
})();
