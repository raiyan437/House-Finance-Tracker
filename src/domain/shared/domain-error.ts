export type DomainErrorCode =
  | "INVALID_ID"
  | "DUPLICATE_PARTICIPANT"
  | "NO_PARTICIPANTS"
  | "INVALID_POISHA"
  | "NON_POSITIVE_EXPENSE_AMOUNT"
  | "MONEY_OVERFLOW"
  | "INVALID_MONEY_TEXT"
  | "INVALID_BASIS_POINTS"
  | "INVALID_PERCENTAGE_TEXT"
  | "PERCENTAGE_TOTAL_NOT_100"
  | "MISSING_SPLIT_ENTRY"
  | "UNKNOWN_SPLIT_PARTICIPANT"
  | "NEGATIVE_SPLIT_SHARE"
  | "AMOUNT_SPLIT_TOTAL_MISMATCH"
  | "INVALID_EXPENSE_DATE"
  | "PAYER_CREATOR_MISMATCH"
  | "ALLOCATION_TOTAL_MISMATCH";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
