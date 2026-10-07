import { errorStatus, messages, type ErrorCode } from '@work/shared';
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public detail?: unknown,
  ) {
    super(messages[code]);
  }
}
export function databaseCode(e: unknown): ErrorCode | null {
  if (typeof e !== 'object' || !e) return null;
  const err = e as { message?: string; code?: string };
  if (err.message && err.message in errorStatus) return err.message as ErrorCode;
  if (err.code === '23503' || err.code === '23505') return 'DEPENDENCY_CONFLICT';
  if (err.code === '23514' || err.code === '22P02' || err.code === '22007' || err.code === '23502')
    return 'VALIDATION_FAILED';
  return null;
}
