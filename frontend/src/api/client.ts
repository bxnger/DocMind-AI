import { getSessionToken, invalidateSession } from './session';
import { errorFromResponse, request } from './transport';

export * from './transport';

function withToken(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

/** Waiting for a session must not outlive a request the user has stopped. */
function tokenFor(signal: AbortSignal | null | undefined): Promise<string> {
  if (!signal) return getSessionToken();
  return new Promise((resolve, reject) => {
    const stop = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) stop();
    signal.addEventListener('abort', stop, { once: true });
    getSessionToken().then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/**
 * A request as the current guest. After a 401 the session is replaced, and only a GET is repeated:
 * a POST or DELETE may cost AI budget or quota, and what it named belonged to the old session anyway.
 */
export async function send(path: string, init?: RequestInit): Promise<Response> {
  const token = await tokenFor(init?.signal);
  let response = await request(path, withToken(init, token));
  if (response.status === 401) {
    invalidateSession(token);
    if ((init?.method ?? 'GET') !== 'GET') throw await errorFromResponse(response);
    response = await request(path, withToken(init, await tokenFor(init?.signal)));
  }
  if (response.ok) return response;
  throw await errorFromResponse(response);
}

/** For the few routes that need no session, so that a health check never creates one. */
export async function getPublicJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await request(path, { signal });
  if (!response.ok) throw await errorFromResponse(response);
  return response.json();
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
