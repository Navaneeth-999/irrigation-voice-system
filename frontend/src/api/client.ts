export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    requestId?: string;
  };
}

export class ApiError extends Error {
  public code: string;
  public details?: any;
  public statusCode: number;

  constructor(message: string, code: string, statusCode: number, details?: any) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const BASE_URL = '/api/v1';

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest', // CSRF protection header
    ...(options.headers as Record<string, string> || {}),
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Includes HttpOnly JWT cookie
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const errorData = data as any;
    const message =
      errorData?.error?.message ||
      errorData?.message ||
      (typeof errorData?.error === 'string' ? errorData.error : null) ||
      `Request failed with status ${response.status}`;
    const code =
      errorData?.error?.code ||
      (typeof errorData?.error === 'string' ? errorData.error : null) ||
      errorData?.code ||
      'REQUEST_FAILED';
    const details = errorData?.details || errorData?.error?.details || errorData;
    throw new ApiError(message, code, response.status, details);
  }

  return (data?.data ?? data) as T;
}
