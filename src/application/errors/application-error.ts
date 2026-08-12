export type ApplicationErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "PERSISTENCE_FAILURE"
  | "MALFORMED_PERSISTED_DATA"
  | "DATABASE_VERSION_BLOCKED"
  | "UNSUPPORTED_DATABASE_VERSION"
  | "DATABASE_RESET_BLOCKED"
  | "SESSION_UNAVAILABLE"
  | "RECEIPT_CONTENT_MISMATCH";

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly context?: Readonly<{ store?: string; key?: string }>;

  constructor(
    code: ApplicationErrorCode,
    message: string,
    context?: Readonly<{ store?: string; key?: string }>,
  ) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.context = context;
  }
}
