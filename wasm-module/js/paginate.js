// client.paginate(url, options) (#44): an async iterator over pages, or over items. Each page is a normal GET.
(() => {
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const linkNext = (response) => {
    for (const [, target, params] of String(response.headers?.link ?? '').matchAll(/<([^>]*)>((?:\s*;\s*(?:[^;,"<]|"[^"]*")+)*)/g)) {
      const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;,\s]+))/i.exec(params);
      if ((rel?.[1] ?? rel?.[2] ?? '').toLowerCase().split(/\s+/).includes('next')) return target;
    }
  };
  WasmClient.prototype.paginate = async function* (url, options) {
    if (options != null && typeof options !== 'object') throw invalid('options', 'must be an object');
    const { items, next = linkNext, maxPages = 1000, crossOrigin = false, ...request } = options ?? {};
    if (items !== undefined && typeof items !== 'function') throw invalid('items', 'must be a function');
    if (typeof next !== 'function') throw invalid('next', 'must be a function');
    if (!Number.isInteger(maxPages) || maxPages < 1) throw invalid('maxPages', 'must be a positive integer');
    const seen = new Set();
    let target = url, init = request;
    for (let page = 0; page < maxPages; page++) {
      const response = await this.get(target, init);
      if (items) yield* await items(response); else yield response;
      const more = await next(response);
      if (!more) return;
      const spec = typeof more === 'string' ? { url: more } : more;
      if (spec === null || typeof spec !== 'object' || (spec.url !== undefined && typeof spec.url !== 'string')) throw invalid('next', 'must return a URL, { url?, params? } or nothing');
      if (spec.url !== undefined) {
        const resolved = new URL(spec.url, response.url);
        if (resolved.origin !== new URL(response.url).origin && !crossOrigin) throw invalid('next', `points to another origin (${resolved.origin}); set crossOrigin: true to follow it`);
        target = resolved.href;
        init = { ...request, params: spec.params };
      } else init = { ...request, params: { ...request.params, ...spec.params } };
      // A server that links back to a page it already sent would loop until maxPages
      const key = JSON.stringify([target, init.params]);
      if (seen.has(key)) return;
      seen.add(key);
    }
  };
})();
