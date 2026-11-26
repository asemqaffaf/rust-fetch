// Browser fetch() and XMLHttpRequest transport, streamed response finalizer, and
// JS body encoder. Policy (retries, timeouts, budgets, circuits, rate limits,
// header/URL validation) stays in the Rust core.
const __browserTransport = (() => {
  const coded = (m, code, extra) => Object.assign(new Error(m), { code }, extra);
  const report = (fn, loaded, total) => { if (fn) try { fn({ loaded, total }); } catch {} };
  const isRedirect = (s) => s === 301 || s === 302 || s === 303 || s === 307 || s === 308;
  const parseCl = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return s && /^\d+$/.test(s) ? Number(s) : null; };
  const joinBytes = (parts, len) => {
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.byteLength; }
    return out;
  };
  const pairsToHeaders = (pairs) => {
    const m = new Map();
    for (const [k, v] of pairs) {
      const l = String(k).toLowerCase(), prev = m.get(l);
      m.set(l, prev === undefined ? String(v) : `${prev}, ${v}`);
    }
    return Object.fromEntries(m);
  };
  const responseHeadersObj = (headers) => {
    const pairs = [...headers], c = headers.get('set-cookie');
    if (c != null) pairs.push(['set-cookie', c]);
    return Object.fromEntries(pairs);
  };
  const tooLargeErr = (limit) => mkErr('NetworkError', `Network error: Response body larger than maxResponseBytes (${limit} bytes)`, { maxResponseBytes: limit });

  function decodeBody(buffer, length, contentType, bodyType) {
    if (length === 0) return bodyType === 2 ? '' : bodyType >= 3 ? new Uint8Array(0) : null;
    const e = String(contentType ?? '').split(';', 1)[0].trim().toLowerCase();
    const isJson = bodyType === 1 || (bodyType === 0 && (e === 'application/json' || e.endsWith('+json')));
    const isText = isJson || bodyType === 2 || (bodyType === 0 && (
      e.startsWith('text/') || e.endsWith('+xml') || e === 'application/xml' || e === 'application/javascript' || e === 'application/x-www-form-urlencoded'
    ));
    if (!isText) return new Uint8Array(buffer);
    const text = decodeUtf8(buffer);
    if (!isJson) return text;
    try { return JSON.parse(text); }
    catch (err) { if (bodyType === 0) return text; throw coded(errMsg(err), 'RUST_FETCH_PARSE'); }
  }

  function xhrCredentials(opts) {
    if (!opts) return false;
    const keys = Object.keys(opts);
    if (!keys.length) return false;
    if (keys.length === 1 && keys[0] === 'credentials') {
      if (opts.credentials === 'same-origin') return false;
      if (opts.credentials === 'include') return true;
    }
  }

  function checkDeclaredLength(headers, limit, url) {
    if (limit == null) return;
    const enc = headers.get('content-encoding');
    const encoded = enc != null && enc.trim().toLowerCase() !== 'identity';
    const cl = parseCl(headers.get('content-length'));
    if (!encoded && cl != null && cl > limit) throw coded('Response too large', 'RUST_FETCH_TOO_LARGE', { maxResponseBytes: limit, url });
  }

  async function readChunks(body, onProgress, total, limit, idleMs, url, controller) {
    const reader = body.getReader(), parts = [];
    let loaded = 0, timer;
    try {
      for (;;) {
        const step = idleMs > 0
          ? await new Promise((res, rej) => {
            timer = setTimeout(() => { controller.abort(); rej(coded('Idle timeout', 'RUST_FETCH_TIMEOUT', { phase: 'idle', timeoutMs: idleMs, url })); }, idleMs);
            reader.read().then((r) => { clearTimeout(timer); res(r); }, (e) => { clearTimeout(timer); rej(e); });
          })
          : await reader.read();
        if (step.done) break;
        const chunk = step.value;
        loaded += chunk.byteLength;
        if (limit != null && loaded > limit) throw coded('Response too large', 'RUST_FETCH_TOO_LARGE', { maxResponseBytes: limit, url });
        report(onProgress, loaded, total);
        parts.push(chunk);
      }
      return joinBytes(parts, loaded).buffer;
    } catch (err) {
      try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
      throw err;
    } finally {
      clearTimeout(timer);
      try { reader.releaseLock(); } catch {}
    }
  }

  function sendXhr(req, withCredentials) {
    let cancel = () => {};
    const p = new Promise((resolve, reject) => {
      let xhr, finished = false;
      try { xhr = new XMLHttpRequest(); } catch (e) { return reject(e); }
      const detach = () => {
        xhr.onreadystatechange = xhr.onload = xhr.onerror = xhr.onprogress = null;
        if (xhr.upload) xhr.upload.onprogress = null;
      };
      cancel = () => { detach(); if (!finished) try { xhr.abort(); } catch {} };
      try {
        xhr.open(req.method, req.url, true);
        if (withCredentials) xhr.withCredentials = true;
        for (const [k, v] of Object.entries(req.headers)) {
          for (const x of Array.isArray(v) ? v : [v]) xhr.setRequestHeader(k, x);
        }
        xhr.responseType = 'arraybuffer';
      } catch (e) { return reject(coded(errMsg(e), 'RUST_FETCH_INVALID_REQUEST')); }
      const total = req.body ? req.body.byteLength : 0;
      req.__observe?.('transport', 'XMLHttpRequest');
      if (req.__observe) {
        let seen = false;
        xhr.onreadystatechange = () => { if (!seen && xhr.readyState >= 2) { seen = true; req.__observe('headers'); } };
      }
      if (req.onUploadProgress && xhr.upload) xhr.upload.onprogress = (e) => report(req.onUploadProgress, e.loaded ?? 0, total);
      if (req.onDownloadProgress) {
        xhr.onprogress = (e) => { if (xhr.status >= 200 && xhr.status < 300) report(req.onDownloadProgress, e.loaded ?? 0, e.lengthComputable ? (e.total ?? null) : null); };
      }
      xhr.onload = () => {
        finished = true; detach();
        try {
          const status = xhr.status | 0, buffer = xhr.response, length = buffer instanceof ArrayBuffer ? buffer.byteLength : 0;
          const pairs = [];
          for (const raw of xhr.getAllResponseHeaders().split('\n')) {
            const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw, i = line.indexOf(':');
            if (i >= 0) pairs.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
          }
          const headers = pairsToHeaders(pairs), url = xhr.responseURL || '';
          if (status < 200 || status >= 300) return resolve({ status, ok: false, url, headers, body: decodeUtf8(buffer) });
          resolve({ status, ok: true, url, headers, body: decodeBody(buffer, length, headers['content-type'] ?? '', req.bodyType ?? 0) });
        } catch (e) { reject(e); }
      };
      xhr.onerror = () => { finished = true; detach(); reject(new Error('XMLHttpRequest failed')); };
      try { xhr.send(req.body ?? null); } catch (e) { finished = true; detach(); reject(e); }
    });
    p.cancel = cancel;
    return p;
  }

  function browserTransport(req) {
    const redir = req.redirect === 'manual' ? 'manual' : req.maxRedirects === 0 ? 'error' : 'follow';
    if (!req.stream && !req.upload && req.onUploadProgress && redir === 'follow'
      && req.maxResponseBytes == null && req.responseTimeout == null && req.idleTimeout == null
      && typeof XMLHttpRequest === 'function') {
      const creds = xhrCredentials(req.fetchOptions);
      if (creds !== undefined) return sendXhr(req, creds);
    }

    let controller, session, respTimer, settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(respTimer);
      try { controller?.abort(); } catch {}
      try { session?.cancel?.(); } catch {}
    };

    const p = (async () => {
      if (req.upload && !globalThis[Symbol.for('rust-fetch.upload')]?.supported?.()) {
        throw coded('Streaming uploads are unavailable in this runtime', 'RUST_FETCH_UPLOAD_INPUT');
      }
      let jsHeaders;
      try {
        jsHeaders = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          for (const x of Array.isArray(v) ? v : [v]) jsHeaders.append(k, x);
        }
      } catch (e) { throw coded(errMsg(e), 'RUST_FETCH_INVALID_REQUEST'); }

      // Null prototype: fetch() reads credentials, mode, cache, signal, duplex, etc. by inheritance.
      const init = { __proto__: null, method: req.method, headers: jsHeaders };
      if (req.body) init.body = typeof Blob === 'function' ? new Blob([req.body]) : req.body;
      if (redir !== 'follow') init.redirect = 'manual';
      if (req.fetchOptions) Object.assign(init, req.fetchOptions);
      controller = new AbortController();
      init.signal = controller.signal;
      if (req.upload) {
        try { session = req.upload.open(req.onUploadProgress); init.body = session.readable(); init.duplex = 'half'; }
        catch (e) { throw coded(errMsg(e), 'RUST_FETCH_UPLOAD_INPUT'); }
      }
      let request;
      try { request = new Request(req.url, init); }
      catch (e) { try { session?.cancel?.(); } catch {} throw coded(errMsg(e), 'RUST_FETCH_INVALID_REQUEST'); }

      req.__observe?.('transport', 'fetch');
      let response;
      try {
        const fetching = fetch(request);
        response = req.responseTimeout > 0
          ? await new Promise((res, rej) => {
            respTimer = setTimeout(() => {
              controller.abort(); try { session?.cancel?.(); } catch {}
              rej(coded('Response timeout', 'RUST_FETCH_TIMEOUT', { phase: 'response', timeoutMs: req.responseTimeout }));
            }, req.responseTimeout);
            fetching.then((r) => { clearTimeout(respTimer); res(r); }, (e) => { clearTimeout(respTimer); rej(e); });
          })
          : await fetching;
      } catch (err) {
        req.__observe?.('cause', err);
        const fail = session?.failure?.();
        try { session?.cancel?.(); } catch {}
        if (fail) {
          if (fail.invalidInput) throw coded(fail.error || '', 'RUST_FETCH_UPLOAD_INPUT');
          throw fail.cause ?? err;
        }
        throw err;
      }

      const status = response.status, headers = response.headers;
      req.__observe?.('headers');
      if (!req.stream && req.onUploadProgress && req.body?.byteLength > 0) report(req.onUploadProgress, req.body.byteLength, req.body.byteLength);
      const redirected = redir !== 'follow' && (response.type === 'opaqueredirect' || isRedirect(status));
      if (redirected && redir === 'error') {
        const loc = headers.get('location');
        try { session?.cancel?.(); } catch {}
        throw new Error(loc ? `Redirect not allowed: ${status} to ${loc}` : 'Redirect not allowed');
      }
      const opaque = redirected || response.type === 'opaque', url = response.url || req.url;

      if ((status < 200 || status >= 300) && !opaque) {
        checkDeclaredLength(headers, req.maxResponseBytes, response.url || '');
        const buffer = (req.maxResponseBytes != null || req.idleTimeout != null) && response.body
          ? await readChunks(response.body, undefined, null, req.maxResponseBytes, req.idleTimeout, response.url || '', controller)
          : await response.arrayBuffer();
        settled = true; try { session?.cancel?.(); } catch {}
        return { status, ok: false, url: response.url || '', headers: responseHeadersObj(headers), body: decodeUtf8(buffer) };
      }
      if (req.stream) {
        settled = true;
        return { status, ok: status >= 200 && status < 300, url, headers: responseHeadersObj(headers), body: response.body, cancelBody: () => controller.abort() };
      }

      const total = parseCl(headers.get('content-length'));
      checkDeclaredLength(headers, req.maxResponseBytes, response.url || '');
      const dl = status >= 200 && status < 300 ? req.onDownloadProgress : undefined;
      let buffer, reported = false;
      if ((dl || req.maxResponseBytes != null || req.idleTimeout != null) && response.body) {
        buffer = await readChunks(response.body, dl, total, req.maxResponseBytes, req.idleTimeout, response.url || '', controller);
        reported = !!dl;
      } else {
        buffer = await response.arrayBuffer();
      }
      settled = true; try { session?.cancel?.(); } catch {}
      if (dl && !reported) report(dl, buffer.byteLength, total);
      let body;
      try { body = decodeBody(buffer, buffer.byteLength, headers.get('content-type') ?? '', req.bodyType ?? 0); }
      catch (e) { if (response.url && e && typeof e === 'object') e.url = response.url; throw e; }
      return { status, ok: status >= 200 && status < 300, url, headers: responseHeadersObj(headers), body };
    })();

    p.cancel = cancel;
    return p;
  }

  function finalizeStream(res, cfg) {
    let headers = ownProp(res, 'headers');
    if (Array.isArray(headers)) headers = pairsToHeaders(headers);
    else if (!headers || typeof headers !== 'object') headers = {};
    else if (Object.getPrototypeOf(headers) === null) Object.setPrototypeOf(headers, Object.prototype);

    const total = parseCl(ownProp(headers, 'content-length'));
    const limit = cfg.maxResponseBytes, declaredTooLarge = limit != null && total != null && total > limit;
    const idleMs = cfg.idleMs, signal = cfg.signal, onProgress = cfg.onDownloadProgress;
    const rawBody = ownProp(res, 'body'), reader = rawBody ? rawBody.getReader() : null;
    const cancelBody = ownProp(res, 'cancelBody');

    let cleaned = false, loaded = 0, terminalErr, deadlineTimer, idleTimer, wake, onAbort;
    const cancelErr = () => mkErr('CancelledError', 'Request was cancelled', signal?.aborted ? { reason: signal.reason, cause: signal.reason } : undefined);
    const cleanup = (isEof) => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(deadlineTimer); clearTimeout(idleTimer);
      if (signal && onAbort) { try { signal.removeEventListener('abort', onAbort); } catch {} }
      if (cfg.onDone) { const d = cfg.onDone; cfg.onDone = undefined; try { d(); } catch {} }
      if (!isEof) {
        try { cancelBody?.(); } catch {}
        if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
      } else if (reader) { try { reader.releaseLock(); } catch {} }
    };
    const fail = (err) => {
      if (!terminalErr) terminalErr = err;
      cleanup(false);
      if (wake) { const w = wake; wake = undefined; w(terminalErr); }
    };

    if (cfg.deadlineMs != null) {
      const err = mkErr('TimeoutError', `Request total timeout after ${cfg.totalDeadlineMs}ms`, { phase: 'total', timeoutMs: cfg.totalDeadlineMs });
      if (cfg.deadlineMs <= 0) fail(err);
      else deadlineTimer = setTimeout(() => fail(err), cfg.deadlineMs);
    }
    if (signal) {
      if (signal.aborted) fail(cancelErr());
      else { onAbort = () => fail(cancelErr()); signal.addEventListener('abort', onAbort, { __proto__: null, once: true }); }
    }

    const readChunk = async () => {
      if (terminalErr) throw terminalErr;
      if (declaredTooLarge) { const err = tooLargeErr(limit); fail(err); throw err; }
      if (!reader) { cleanup(true); return null; }
      const step = await new Promise((resolve, reject) => {
        let done = false;
        const settle = (ok, v) => { if (done) return; done = true; clearTimeout(idleTimer); wake = undefined; ok ? resolve(v) : reject(v); };
        wake = (err) => settle(false, err);
        if (idleMs > 0) {
          idleTimer = setTimeout(() => {
            const err = mkErr('TimeoutError', `Request idle timeout after ${idleMs}ms`, { phase: 'idle', timeoutMs: idleMs });
            fail(err); settle(false, err);
          }, idleMs);
        }
        reader.read().then(
          (r) => settle(true, r),
          (e) => {
            if (terminalErr) return settle(false, terminalErr);
            const err = signal?.aborted ? cancelErr() : mkErr('NetworkError', `Network error: Failed to read response body: ${errMsg(e)}`);
            fail(err); settle(false, err);
          },
        );
      });
      if (step.done) { cleanup(true); return null; }
      let chunk = step.value;
      if (chunk instanceof Uint8Array) { if (chunk.byteOffset || chunk.byteLength !== chunk.buffer.byteLength) chunk = chunk.slice(); }
      else if (ArrayBuffer.isView(chunk)) chunk = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength).slice();
      else if (chunk instanceof ArrayBuffer) chunk = new Uint8Array(chunk);
      if (chunk instanceof Uint8Array) {
        loaded += chunk.byteLength;
        if (limit != null && loaded > limit) { const err = tooLargeErr(limit); fail(err); throw err; }
        report(onProgress, loaded, total);
      }
      return chunk;
    };

    const ndjson = !!cfg.ndjson, maxLine = cfg.maxLineBytes, pending = [];
    let partial = new Uint8Array(0), lineNo = 0, eof = false;
    const appendPartial = (slice) => {
      if (maxLine != null) {
        const last = slice.length ? slice[slice.length - 1] : partial.length ? partial[partial.length - 1] : 0;
        if (partial.length + slice.length - (last === 13 ? 1 : 0) > maxLine) {
          return mkErr('NetworkError', `Network error: Line longer than maxLineBytes (${maxLine} bytes)`, { maxLineBytes: maxLine });
        }
      }
      if (!slice.length) return;
      partial = partial.length ? joinBytes([partial, slice], partial.length + slice.length) : slice.slice();
    };
    const completeLine = (bytes) => {
      lineNo++;
      const text = decodeUtf8(bytes.subarray(0, bytes.length && bytes[bytes.length - 1] === 13 ? bytes.length - 1 : bytes.length));
      if (/[^\t\n\f\r ]/.test(text)) pending.push([lineNo, text]);
    };

    const body = safeStream({
      async pull(controller) {
        if (!ndjson) {
          const chunk = await readChunk();
          return chunk === null ? controller.close() : controller.enqueue(chunk);
        }
        for (;;) {
          if (pending.length) {
            const item = pending.shift();
            if (!Array.isArray(item)) { fail(item); throw item; }
            try { controller.enqueue(JSON.parse(item[1])); return; }
            catch (e) { const pe = mkErr('ParseError', `Parse error: Failed to parse line ${item[0]} as JSON: ${errMsg(e)}`); fail(pe); throw pe; }
          }
          if (eof) return controller.close();
          const chunk = await readChunk();
          if (chunk === null) { eof = true; if (partial.length) { completeLine(partial); partial = new Uint8Array(0); } continue; }
          let pos = 0;
          for (let idx; (idx = chunk.indexOf(10, pos)) !== -1; pos = idx + 1) {
            const err = appendPartial(chunk.subarray(pos, idx));
            if (err) { pending.push(err); eof = true; break; }
            completeLine(partial); partial = new Uint8Array(0);
          }
          if (!eof && pos < chunk.length) {
            const err = appendPartial(chunk.subarray(pos));
            if (err) { pending.push(err); eof = true; }
          }
        }
      },
      cancel() { cleanup(false); },
    }, 0);
    return { status: res.status, statusText: res.statusText, ok: res.status >= 200 && res.status < 300, url: ownProp(res, 'url') || '', headers, body };
  }

  function encodeBody(value) {
    if (value instanceof Uint8Array) return [0, value.byteOffset || value.byteLength !== value.buffer.byteLength ? value.slice() : value, ''];
    if (value instanceof ArrayBuffer) return [0, new Uint8Array(value), ''];
    if (ArrayBuffer.isView(value)) return [0, new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice(), ''];
    if (typeof URLSearchParams === 'function' && value instanceof URLSearchParams) return [1, value.toString(), 'application/x-www-form-urlencoded;charset=UTF-8'];
    if (typeof Blob === 'function' && value instanceof Blob) return value.arrayBuffer().then((b) => [0, new Uint8Array(b), value.type || 'application/octet-stream']);
    if (typeof FormData === 'function' && value instanceof FormData) {
      return (async () => {
        const rand = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
        const boundary = `----rust-fetch-${rand}`;
        const esc = (s) => String(s).replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
        const parts = [];
        let len = 0;
        const push = (b) => { parts.push(b); len += b.byteLength; };
        for (const [name, val] of value) {
          if (typeof val === 'string') {
            push(encodeUtf8(`--${boundary}\r\nContent-Disposition: form-data; name="${esc(name)}"\r\n\r\n${val}\r\n`));
          } else {
            push(encodeUtf8(`--${boundary}\r\nContent-Disposition: form-data; name="${esc(name)}"; filename="${esc(typeof val.name === 'string' ? val.name : 'blob')}"\r\nContent-Type: ${val.type || 'application/octet-stream'}\r\n\r\n`));
            push(new Uint8Array(await val.arrayBuffer()));
            push(encodeUtf8('\r\n'));
          }
        }
        push(encodeUtf8(`--${boundary}--\r\n`));
        return [2, joinBytes(parts, len), `multipart/form-data; boundary=${boundary}`];
      })();
    }
    return null;
  }

  browserTransport.decodeBody = decodeBody;
  browserTransport.finalizeStream = finalizeStream;
  browserTransport.encodeBody = encodeBody;
  return browserTransport;
})();
