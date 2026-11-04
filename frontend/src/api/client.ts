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

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

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
  try {
    response = await fetch(apiUrl(path), init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw networkError();
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
