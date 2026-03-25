const BASE_URL = import.meta.env.VITE_API_URL as string;

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
  }
}

export async function apiFetch<TData>(endpoint: string): Promise<TData> {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.statusText,
      `Request failed: ${response.status} ${response.statusText} — ${url}`,
    );
  }

  return response.json() as Promise<TData>;
}

export async function apiPost<TData, TBody = unknown>(
  endpoint: string,
  body: TBody,
): Promise<TData> {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.statusText,
      `Request failed: ${response.status} ${response.statusText} — ${url}`,
    );
  }

  return response.json() as Promise<TData>;
}

export async function apiPatch<TData, TBody = unknown>(
  endpoint: string,
  body: TBody,
): Promise<TData> {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.statusText,
      `Request failed: ${response.status} ${response.statusText} — ${url}`,
    );
  }

  return response.json() as Promise<TData>;
}

export async function apiDownload(endpoint: string, filename?: string): Promise<void> {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  const response = await fetch(url);

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