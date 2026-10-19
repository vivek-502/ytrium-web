/** Tiny HTTP client for the backend API with timeouts + error normalization. */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT = 45_000;

/* --------------------------- session expiry hook -------------------------- */

let unauthorizedHandler: (() => void) | null = null;

/**
 * Registered by the auth store. Any API 401 (expired or revoked session)
 * drops the app back to the sign-in screen instead of failing silently.
 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

interface RequestOptions {
  params?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function buildUrl(path: string, params?: RequestOptions['params']): string {
  if (!params) return path;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort);

  try {
    const res = await fetch(buildUrl(path, opts.params), {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      if (res.status === 401) unauthorizedHandler?.();
      throw new ApiError(
        err?.code ?? 'HTTP_ERROR',
        res.status,
        err?.message ?? defaultMessageForStatus(res.status),
      );
    }
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new ApiError('TIMEOUT', 0, 'The request timed out. Please try again.');
    }
    throw new ApiError('NETWORK', 0, 'Cannot reach the server. Check that the backend is running.');
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

function defaultMessageForStatus(status: number): string {
  if (status === 429) return 'Too many requests. Please slow down.';
  if (status === 404) return 'Not found.';
  if (status >= 500) return 'The server had a problem. Please try again.';
  return 'Something went wrong. Please try again.';
}

export const http = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('POST', path, body, opts),
  delete: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('DELETE', path, body, opts),
};
