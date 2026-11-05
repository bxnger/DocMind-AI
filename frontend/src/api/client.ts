/** Normalised error for everything that crosses the network boundary. */
export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(options: {
    code: string;
    message: string;
    retryable?: boolean;
    status?: number | null;
    requestId?: string | null;
  }) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
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
export function errorFromBody(status: number, body: unknown): AppError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  return new AppError({
    code: typeof error?.code === 'string' ? error.code : `HTTP_${status}`,
    message: typeof error?.message === 'string' ? error.message : `Request failed with status ${status}`,
    retryable: error?.retryable === true || status >= 500,
    status,
    requestId: typeof error?.requestId === 'string' ? error.requestId : null,
  });
}

export function networkError(): AppError {
  return new AppError({
    code: ERROR_NETWORK,
    message: 'The backend could not be reached',
    retryable: true,
  });
}

export async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
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
    response = await fetch(apiUrl(path), { ...init, signal: controller.signal });
  } catch (cause) {
    if (timedOut) throw timeoutError();
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw networkError();
  } finally {
    // Only the wait for a response is limited: a stream may then run longer, and can still be stopped.
    clearTimeout(timer);
  }
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => null);
  throw errorFromBody(response.status, body);
}

export async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await send(path, { signal });
  return response.json();
}

export async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export async function deleteResource(path: string): Promise<void> {
  await send(path, { method: 'DELETE' });
}
