import { messages, type ErrorCode } from '@work/shared';
export class ApiError extends Error {
  constructor(
    public code: string,
    public detail?: unknown,
  ) {
    super(messages[code as ErrorCode] ?? '操作失败，请重试');
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error?.code ?? 'INTERNAL_ERROR', data.error?.detail);
  return data as T;
}
export const post = <T>(path: string, body: unknown, method = 'POST') =>
  api<T>(path, { method, body: JSON.stringify(body) });
