const ENV_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const BASE_URL =
  ENV_BASE_URL && ENV_BASE_URL !== 'undefined'
    ? ENV_BASE_URL.replace(/\/$/, '')
    : import.meta.env.DEV
      ? 'http://localhost:3000'
      : '';
const AUTH_TOKEN_KEY = 'auth-token';

function buildUrl(endpoint: string): string {
  return endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
}

async function parseJsonResponse<TData>(response: Response, url: string): Promise<TData> {
  const raw = await response.text();

  if (!response.ok) {
    let serverMessage: string | null = null;
    try {
      const parsed = JSON.parse(raw) as { message?: unknown };
      if (typeof parsed.message === 'string') serverMessage = parsed.message;
    } catch { /* not JSON */ }

    throw new ApiError(
      response.status,
      response.statusText,
      `Request failed: ${response.status} ${response.statusText} — ${url}${raw ? ` — ${raw.slice(0, 200)}` : ''}`,
      serverMessage,
    );
  }

  if (response.status === 204 || raw.length === 0) {
    return undefined as TData;
  }

  try {
    return JSON.parse(raw) as TData;
  } catch {
    throw new ApiError(
      response.status,
      response.statusText,
      `Expected JSON response but received non-JSON payload — ${url}`,
    );
  }
}

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly serverMessage: string | null;

  constructor(status: number, statusText: string, message: string, serverMessage: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.serverMessage = serverMessage;
  }
}

export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.serverMessage) {
    return err.serverMessage;
  }
  return fallback;
}

export async function apiFetch<TData>(endpoint: string): Promise<TData> {
  const url = buildUrl(endpoint);

  const response = await fetch(url, {
    headers: authHeaders(),
  });

  return parseJsonResponse<TData>(response, url);
}

export async function apiPost<TData, TBody = unknown>(
  endpoint: string,
  body: TBody,
): Promise<TData> {
  const url = buildUrl(endpoint);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<TData>(response, url);
}

export async function apiPatch<TData, TBody = unknown>(
  endpoint: string,
  body: TBody,
): Promise<TData> {
  const url = buildUrl(endpoint);

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<TData>(response, url);
}

export async function apiPut<TData, TBody = unknown>(
  endpoint: string,
  body: TBody,
): Promise<TData> {
  const url = buildUrl(endpoint);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<TData>(response, url);
}

export async function apiDelete(endpoint: string): Promise<void> {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.statusText,
      `Request failed: ${response.status} ${response.statusText} — ${url}`,
    );
  }
}

export async function apiDownload(endpoint: string, filename?: string): Promise<void> {
  const url = buildUrl(endpoint);

  const response = await fetch(url, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.statusText,
      `Download failed: ${response.status} ${response.statusText} — ${url}`,
    );
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = objectUrl;

  if (filename) {
    link.download = filename;
  } else {
    const disposition = response.headers.get('Content-Disposition');
    const match = disposition?.match(/filename="?([^"]+)"?/);
    if (match?.[1]) {
      link.download = match[1];
    }
  }

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.URL.revokeObjectURL(objectUrl);
}
