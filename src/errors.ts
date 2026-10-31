export const ERROR_CODES = [
  "NOT_FOUND",
  "DISABLED",
  "PATH_DENIED",
  "BUSY",
  "INVALID_ARGS",
  "BUILD_FAILED",
  "START_FAILED",
  "NOT_RUNNING",
  "STOP_TIMEOUT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AppError";
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
