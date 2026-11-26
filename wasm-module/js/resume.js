// The `resume` option (#51): a streamed GET that continues with a Range request when the connection breaks mid-body.
(() => {
  class ResumingClient extends WasmClient {
    get(url, options) {
      const resume = options?.resume;
      if (!resume) return super.get(url, options);
      const config = resume === true ? {} : resume;
      if (config === null || typeof config !== 'object') return Promise.reject(invalidInput('resume', 'must be true or { maxResumes }'));
      const { maxResumes = 3, ...unknown } = config;
      if (!Number.isInteger(maxResumes) || maxResumes < 1 || Object.keys(unknown).length) return Promise.reject(invalidInput('resume', 'maxResumes must be a positive integer'));
      if (options.responseType !== 'stream') return Promise.reject(invalidInput('resume', "needs responseType: 'stream'"));
      const { resume: _, ...rest } = options;
      return super.get(url, rest).then((response) => follow(this, url, rest, response, maxResumes));
    }
  }
  function follow(client, url, rest, response, maxResumes) {
    const headers = response.headers;
    const validator = headers.etag && !headers.etag.startsWith('W/') ? headers.etag : headers['last-modified'];
    // Only a plain 200 with byte ranges, a validator to check the file hasn't changed, and no content coding (ranges count encoded bytes)
    if (response.status !== 200 || headers['accept-ranges'] !== 'bytes' || !validator || (headers['content-encoding'] && headers['content-encoding'] !== 'identity')) return response;
    let reader = response.body.getReader(), received = 0, resumes = 0;
    const body = safeStream({
      async pull(controller) {
        for (;;) {
          try {
            const { done, value } = await reader.read();
            if (done) return controller.close();
            received += value.byteLength;
            return controller.enqueue(value);
          } catch (error) {
            if ((error?.kind !== 'NetworkError' && error?.kind !== 'TimeoutError') || resumes >= maxResumes) return controller.error(error);
            resumes++;
            try {
              const next = await client.get(url, { ...rest, headers: { ...lowerHeaders(rest.headers), range: `bytes=${received}-`, 'if-range': validator } });
              // 200 means the file changed (If-Range failed); anything but the bytes from `received` on is no continuation
              if (next.status !== 206 || !String(next.headers['content-range'] ?? '').startsWith(`bytes ${received}-`)) {
                next.body.cancel().catch(() => {});
                return controller.error(Object.assign(error, { cause: error.cause ?? new Error('The download could not be resumed: the server did not continue from the same byte, or the file changed') }));
              }
              reader = next.body.getReader();
            } catch (resumeError) {
              return controller.error(Object.assign(error, { cause: error.cause ?? resumeError }));
            }
          }
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
    return Object.defineProperty({ ...response, body }, 'resumes', { __proto__: null, get: () => resumes, enumerable: true });
  }
  wrapClient(ResumingClient);
})();
