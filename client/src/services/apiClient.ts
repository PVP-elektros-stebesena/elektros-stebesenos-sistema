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
