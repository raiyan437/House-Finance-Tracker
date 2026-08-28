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
  | "INVALID_HOUSEHOLD_CODE"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "COMMANDS_UNAVAILABLE"
  | "HOUSEHOLD_STATE_CHANGED"
  | "RECEIPT_CONTENT_MISMATCH"
  | "BACKDATED_EXPENSE_CONFIRMATION_REQUIRED"
  | "EXPENSE_VERSION_CONFLICT"
  | "RECEIPT_COUNT_LIMIT_EXCEEDED"
  | "RECEIPT_USER_QUOTA_EXCEEDED"
  | "RECEIPT_PROJECT_CAPACITY_EXCEEDED"
  | "RECEIPT_PRIVATE_ACCESS_FORBIDDEN"
  | "RECEIPT_PARTIAL_SUCCESS"
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

/** Expense persistence completed, but one or more separate Receipt sagas did not. */
export class ReceiptSagaPartialSuccessError extends ApplicationError {
  readonly savedExpenseId: string;
  readonly failedReceiptOperations: number;

  constructor(savedExpenseId: string, failedReceiptOperations: number) {
    super(
      "RECEIPT_PARTIAL_SUCCESS",
      failedReceiptOperations === 1
        ? "The Expense was saved, but one Receipt change did not finish. Your Receipt draft is still here; retry to finish it."
        : `The Expense was saved, but ${failedReceiptOperations} Receipt changes did not finish. Your Receipt drafts are still here; retry to finish them.`,
    );
    this.name = "ReceiptSagaPartialSuccessError";
    this.savedExpenseId = savedExpenseId;
    this.failedReceiptOperations = failedReceiptOperations;
  }
}
