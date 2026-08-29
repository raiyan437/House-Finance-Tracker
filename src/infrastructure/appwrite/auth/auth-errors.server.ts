export type AuthErrorCode = "RATE_LIMITED" | "INVALID_INPUT" | "SESSION_INVALID" | "PROVIDER_UNAVAILABLE" | "EMAIL_NOT_PERMITTED";

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
  }
}
