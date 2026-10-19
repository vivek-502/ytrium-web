/**
 * Application error with a stable machine code and a user-facing message.
 * Stack traces and provider stderr are logged, never returned to clients.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: string;

  constructor(code: string, status: number, message: string, detail?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export const errors = {
  invalidInput: (detail?: string) =>
    new AppError('INVALID_INPUT', 400, 'That request could not be understood.', detail),
  notFound: (message = 'The requested item could not be found.') =>
    new AppError('NOT_FOUND', 404, message),
  upstreamUnavailable: (detail?: string) =>
    new AppError(
      'UPSTREAM_UNAVAILABLE',
      502,
      'The music service is unavailable right now. Please try again shortly.',
      detail,
    ),
  videoUnavailable: (detail?: string) =>
    new AppError(
      'VIDEO_UNAVAILABLE',
      422,
      'This track is unavailable. It may have been removed or blocked in your region.',
      detail,
    ),
  extractionFailed: (detail?: string) =>
    new AppError(
      'EXTRACTION_FAILED',
      502,
      'Unable to prepare this track for playback. Try again.',
      detail,
    ),
  timeout: (detail?: string) =>
    new AppError('TIMEOUT', 504, 'The request timed out. Please try again.', detail),
  rateLimited: () =>
    new AppError('RATE_LIMITED', 429, 'Too many requests. Please slow down.'),
  internal: (detail?: string) =>
    new AppError('INTERNAL', 500, 'Something went wrong on our side.', detail),
};

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
