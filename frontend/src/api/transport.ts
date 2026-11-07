/** Normalised error for everything that crosses the network boundary. */
export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly requestId: string | null;
  /** Seconds from the Retry-After header. */
  readonly retryAfter: number | null;

  constructor(options: {
    code: string;
    message: string;
    retryable?: boolean;
    status?: number | null;
    requestId?: string | null;
    retryAfter?: number | null;
  }) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
    this.retryAfter = options.retryAfter ?? null;
  }
}

export const ERROR_NETWORK = 'NETWORK_ERROR';
export const ERROR_BAD_RESPONSE = 'BAD_RESPONSE';

// The fallback exists only in development. vite.config.ts stops a production build without a real address.
const DEFAULT_BASE_URL = import.meta.env.DEV ? 'http://127.0.0.1:8000' : '';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

export const ERROR_TIMEOUT = 'REQUEST_TIMEOUT';
/** How long a server may take to start answering. The chat's search and translation happen before that. */
export const RESPONSE_TIMEOUT_MS = 45_000;

export function timeoutError(): AppError {
  return new AppError({ code: ERROR_TIMEOUT, message: 'The backend took too long to respond', retryable: true });
}

export function apiUrl(path: string): string {
  return `${API_BASE_URL}/api/v1${path}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Turns a parsed non-2xx body in the backend's `{ error: {...} }` shape into an AppError. */
export function parseRetryAfter(value: string | null | undefined): number | null {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function errorFromBody(status: number, body: unknown, retryAfter?: string | null): AppError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  return new AppError({
    code: typeof error?.code === 'string' ? error.code : `HTTP_${status}`,
    message: typeof error?.message === 'string' ? error.message : `Request failed with status ${status}`,
    // The server's own answer decides. Without one (a proxy's error page) only a server failure is worth retrying.
    retryable: typeof error?.retryable === 'boolean' ? error.retryable : status >= 500,
    status,
    requestId: typeof error?.requestId === 'string' ? error.requestId : null,
    retryAfter: parseRetryAfter(retryAfter),
  });
}

export function networkError(): AppError {
  return new AppError({
    code: ERROR_NETWORK,
    message: 'The backend could not be reached',
    retryable: true,
  });
}

/** One request with a time limit on the wait for a response. No session here: see client.ts. */
export async function request(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, RESPONSE_TIMEOUT_MS);
  const caller = init?.signal;
  const forward = () => controller.abort();
  if (caller?.aborted) controller.abort();
  caller?.addEventListener('abort', forward, { once: true });
  try {
    return await fetch(apiUrl(path), { ...init, signal: controller.signal });
  } catch (cause) {
    if (timedOut) throw timeoutError();
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw networkError();
  } finally {
    // Only the wait for a response is limited: a stream may then run longer, and can still be stopped.
    clearTimeout(timer);
  }
}

export async function errorFromResponse(response: Response): Promise<AppError> {
  const body: unknown = await response.json().catch(() => null);
  return errorFromBody(response.status, body, response.headers.get('Retry-After'));
}
