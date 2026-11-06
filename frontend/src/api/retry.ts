import { AppError } from './transport';

/** Longer than this, and a person is better placed to decide than a background retry. */
const MAX_AUTOMATIC_WAIT_SECONDS = 30;

/** Reading only, once, when the server says it may help, and not sooner than it asks. */
export function shouldRetryQuery(count: number, error: unknown): boolean {
  return count < 1 && error instanceof AppError && error.retryable && (error.retryAfter ?? 0) <= MAX_AUTOMATIC_WAIT_SECONDS;
}

export function queryRetryDelay(_count: number, error: unknown): number {
  return error instanceof AppError && error.retryAfter !== null ? error.retryAfter * 1000 : 1000;
}
