import { CliError, exitFor } from './errors';

export type Fetch = typeof fetch;
export async function request<T>(
  fetcher: Fetch,
  server: string,
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(new URL(path, server), {
      method: options.method ?? 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new CliError(
      'NETWORK_ERROR',
      'Request failed or timed out; check the server and connection',
      6,
    );
  }
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new CliError('INVALID_RESPONSE', 'Server did not return JSON', 6);
  }
  if (!response.ok) {
    const code =
      typeof data?.error?.code === 'string' ? data.error.code : `HTTP_${response.status}`;
    throw new CliError(
      code,
      typeof data?.error?.message === 'string' ? data.error.message : 'Request failed',
      exitFor(code),
      data?.error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
      data?.error?.detail,
    );
  }
  return data as T;
}
