// The `auth` client option (#70): bearer tokens with a single-flight refresh on 401, and Basic credentials. Only for the client's own origin(s).
(() => {
  const Base = WasmClient, states = new WeakMap();
  const invalid = (parameter, message) => Object.assign(new TypeError(message), { kind: 'InvalidInputError', parameter });
  const originOf = (value, base) => { try { return new URL(value, base).origin; } catch { return undefined; } };
  const value = async (auth) => {
    if (auth.basic) {
      const bytes = new TextEncoder().encode(`${auth.basic.username}:${auth.basic.password}`);
      return `Basic ${btoa(String.fromCharCode(...bytes))}`;
    }
    const token = typeof auth.bearer === 'function' ? await auth.bearer() : auth.bearer;
    return token == null || token === '' ? undefined : `Bearer ${token}`;
  };
  function validate(auth, baseUrl) {
    if (auth === null || typeof auth !== 'object') throw invalid('auth', 'must be an object');
    const { bearer, basic, refresh, origins } = auth;
    if ((bearer === undefined) === (basic === undefined)) throw invalid('auth', 'needs exactly one of bearer and basic');
    if (bearer !== undefined && typeof bearer !== 'string' && typeof bearer !== 'function') throw invalid('auth.bearer', 'must be a string or a function');
    if (basic !== undefined && (basic === null || typeof basic.username !== 'string' || typeof basic.password !== 'string')) throw invalid('auth.basic', 'must be { username, password } strings');
    if (refresh !== undefined && (typeof refresh !== 'function' || basic !== undefined)) throw invalid('auth.refresh', 'must be a function, and needs bearer');
    if (origins !== undefined && (!Array.isArray(origins) || origins.some((origin) => typeof origin !== 'string' || originOf(origin) === undefined))) throw invalid('auth.origins', 'must be an array of URLs');
    const allowed = new Set((origins ?? []).map((origin) => originOf(origin)));
    if (baseUrl != null) allowed.add(originOf(baseUrl));
    if (allowed.size === 0 || allowed.has(undefined)) throw invalid('auth', 'needs a valid baseUrl or auth.origins: credentials are only sent to origins you name');
    return allowed;
  }
  const install = (client, state) => {
    state.id = Base.prototype.addRequestInterceptor.call(client, async (request) => {
      if (!state.origins.has(originOf(request.url, state.baseUrl))) return;
      if (Object.keys(request.headers).some((name) => name.toLowerCase() === 'authorization')) return;
      const header = await value(state.auth);
      if (header) request.headers.authorization = header;
    });
  };
  const replayable = (args) => typeof ReadableStream === 'undefined' || !args.some((arg) => arg instanceof ReadableStream || arg?.body instanceof ReadableStream);
  class AuthClient extends Base {
    constructor(options) {
      const auth = options != null && Object.hasOwn(Object(options), 'auth') ? options.auth : undefined;
      const baseUrl = options?.baseUrl;
      const origins = auth === undefined ? undefined : validate(auth, baseUrl);
      super(options);
      if (auth !== undefined) {
        const state = { auth, origins, baseUrl, epoch: 0, outcome: undefined, refreshing: undefined, id: 0 };
        states.set(this, state);
        install(this, state);
      }
    }
    clearInterceptors() {
      super.clearInterceptors();
      const state = states.get(this);
      if (state) install(this, state);
    }
  }
  for (const name of ['get', 'head', 'delete', 'post', 'put', 'patch', 'post_json', 'put_json', 'patch_json', 'request', 'fetch']) {
    const raw = Base.prototype[name];
    AuthClient.prototype[name] = function (...args) {
      const state = states.get(this);
      if (!state?.auth.refresh) return raw.apply(this, args);
      const epoch = state.epoch;
      return raw.apply(this, args).catch(async (error) => {
        if (error?.kind !== 'HttpError' || error.status !== 401 || !state.origins.has(originOf(error.url, state.baseUrl)) || !replayable(args)) throw error;
        // Requests failing together share one refresh. One that started before a refresh settled uses its outcome, so a failed refresh isn't run again for each.
        if (state.epoch === epoch) {
          state.refreshing ??= Promise.resolve().then(() => state.auth.refresh()).then(() => ({}), (cause) => ({ cause })).then((outcome) => { state.epoch++; state.outcome = outcome; state.refreshing = undefined; });
          await state.refreshing;
        }
        if (state.outcome.cause !== undefined) {
          if (error.cause === undefined) error.cause = state.outcome.cause;
          throw error;
        }
        return raw.apply(this, args);
      });
    };
  }
  Object.defineProperty(AuthClient, 'name', { value: 'WasmClient' });
  WasmClient = AuthClient;
})();
