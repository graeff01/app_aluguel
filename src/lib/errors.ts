export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "MISSING_DATA"
  | "RATE_LIMITED"
  | "INVALID_STATE";

const STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  MISSING_DATA: 422,
  RATE_LIMITED: 429,
  INVALID_STATE: 409,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = () => new AppError("NOT_FOUND", "Registro não encontrado ou sem permissão de acesso.");
export const forbidden = (msg = "Você não tem permissão para esta ação.") => new AppError("FORBIDDEN", msg);
