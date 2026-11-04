export class CliError extends Error {
  constructor(
    public code: string,
    message: string,
    public exitCode = 1,
    public requestId?: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

export function exitFor(code: string) {
  if (code === 'UNAUTHENTICATED') return 3;
  if (code === 'FORBIDDEN') return 4;
  if (code === 'VERSION_CONFLICT' || code === 'DEPENDENCY_CONFLICT') return 5;
  return 1;
}

export function usage(message: string): never {
  throw new CliError('USAGE_ERROR', message, 2);
}
