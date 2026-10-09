import { API_URL } from '../config';
import type { AuthResult } from '../types';
import * as tokens from '../auth/tokenStore';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public retryAfterSec?: number) {
    super(message ?? code);
  }
}

async function raw(method: string, path: string, opts: { body?: unknown; token?: string | null } = {}) {
  // AbortSignal.timeout() is not available on every Hermes build; use a plain controller.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body, e.g. an HTML 502 from a proxy */
    }
    if (!res.ok) {
      throw new ApiError(
        res.status,
        json?.error?.code ?? `http_${res.status}`,
        json?.error?.message,
        Number(res.headers.get('retry-after')) || undefined,
      );
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ token refresh (single flight)
// Refresh tokens are single use. Two concurrent refreshes would present the same token twice,
// which the server treats as theft and revokes the whole session. So: exactly one in flight.
let refreshing: Promise<string> | null = null;
let onSessionLost: (() => void) | null = null;
export const setSessionLostHandler = (fn: () => void) => (onSessionLost = fn);

export function refreshAccessToken(): Promise<string> {
  refreshing ??= (async () => {
    try {
      const rt = await tokens.getRefreshToken();
      if (!rt) throw new ApiError(401, 'no_refresh_token');
      const r = (await raw('POST', '/v1/auth/refresh', { body: { refreshToken: rt } })) as AuthResult;
      await tokens.saveTokens(r.accessToken, r.refreshToken, r.expiresIn);
      return r.accessToken;
    } catch (err) {
      // Only a definitive rejection ends the session; network errors must NOT log the user out.
      if (err instanceof ApiError && err.status === 401) {
        await tokens.clear();
        onSessionLost?.();
      }
      throw err;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Returns a valid access token, refreshing proactively when < 60 s remain. */
export async function getAccessToken(): Promise<string | null> {
  const t = await tokens.getAccessToken();
  if (t && !tokens.isExpiringSoon()) return t;
  if (!(await tokens.getRefreshToken())) return null;
  return refreshAccessToken();
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let token = await getAccessToken();
  try {
    return (await raw(method, path, { body, token })) as T;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && token) {
      token = await refreshAccessToken();
      return (await raw(method, path, { body, token })) as T;
    }
    throw err;
  }
}

/** Unauthenticated calls (login flow). */
export const publicApi = <T = unknown>(method: string, path: string, body?: unknown) =>
  raw(method, path, { body }) as Promise<T>;
