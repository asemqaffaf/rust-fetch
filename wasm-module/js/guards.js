// Type guards for rust-fetch errors (#68). Shape checks, not `instanceof`: an error from another realm or copy of the package counts too.
const ERROR_KINDS = new Set(['CircuitOpenError', 'NetworkError', 'HttpError', 'ParseError', 'TimeoutError', 'InvalidInputError', 'JsInteropError', 'CancelledError']);
export function isRustFetchError(value, kind) {
  if (value === null || typeof value !== 'object') return false;
  const found = value.kind;
  return ERROR_KINDS.has(found) && typeof value.message === 'string' && (kind === undefined || found === kind);
}
export const isHttpError = (value) => isRustFetchError(value, 'HttpError');
export const isTimeoutError = (value) => isRustFetchError(value, 'TimeoutError');
export const isNetworkError = (value) => isRustFetchError(value, 'NetworkError');
export const isParseError = (value) => isRustFetchError(value, 'ParseError');
export const isInvalidInputError = (value) => isRustFetchError(value, 'InvalidInputError');
export const isCancelledError = (value) => isRustFetchError(value, 'CancelledError');
export const isCircuitOpenError = (value) => isRustFetchError(value, 'CircuitOpenError');
export const isJsInteropError = (value) => isRustFetchError(value, 'JsInteropError');
