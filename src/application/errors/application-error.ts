export type ApplicationErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "PERSISTENCE_FAILURE"
  | "MALFORMED_PERSISTED_DATA"
  | "DATABASE_VERSION_BLOCKED"
  | "UNSUPPORTED_DATABASE_VERSION"
  | "DATABASE_RESET_BLOCKED"
  | "SESSION_UNAVAILABLE"
  | "HOUSEHOLD_CODE_GENERATION_EXHAUSTED"
  | "HOUSEHOLD_STATE_CHANGED"
  | "RECEIPT_CONTENT_MISMATCH"
  | "BACKDATED_EXPENSE_CONFIRMATION_REQUIRED"
  | "EXPENSE_VERSION_CONFLICT"
  | "RECEIPT_COUNT_LIMIT_EXCEEDED"
  | "RECEIPT_USER_QUOTA_EXCEEDED"
  | "RECEIPT_PROJECT_CAPACITY_EXCEEDED"
  | "RECEIPT_PRIVATE_ACCESS_FORBIDDEN"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDEMPOTENCY_IN_PROGRESS";

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

export class BackdatedExpenseConfirmationRequiredError extends ApplicationError {
  readonly confirmationToken: string;

  constructor(confirmationToken: string) {
    super(
      "BACKDATED_EXPENSE_CONFIRMATION_REQUIRED",
      "This expense is dated before a household settlement that was already confirmed.",
    );
    this.name = "BackdatedExpenseConfirmationRequiredError";
    this.confirmationToken = confirmationToken;
  }
}
