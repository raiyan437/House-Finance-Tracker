import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalIntent } from "@/application/idempotency/command-idempotency";
import type {
  BackdatedExpenseConfirmationAuthority,
  BackdatedExpenseConfirmationPayload,
} from "@/application/expenses/backdated-expense-confirmation";
import type { IsoInstant } from "@/domain/shared/instant";

const CONTEXT = "hft:backdated-expense:v1";
const VALIDITY_MS = 15 * 60 * 1000;

interface SignedClaims {
  readonly payload: BackdatedExpenseConfirmationPayload;
  readonly expiresAt: string;
}

function signature(secret: string, encodedClaims: string): Buffer {
  return createHmac("sha256", secret).update(CONTEXT).update("\0").update(encodedClaims).digest();
}

export function createServerBackdatedConfirmationAuthority(
  secret: string,
  now: () => IsoInstant,
): BackdatedExpenseConfirmationAuthority {
  if (!secret) throw new Error("HFT_AUTH_HMAC_SECRET is required for backdated Expense confirmation.");
  return Object.freeze({
    issue(payload: BackdatedExpenseConfirmationPayload) {
      const expiresAt = new Date(Date.parse(now()) + VALIDITY_MS).toISOString();
      const encodedClaims = Buffer.from(canonicalIntent({ payload, expiresAt }), "utf8").toString("base64url");
      return `${encodedClaims}.${signature(secret, encodedClaims).toString("base64url")}`;
    },
    verify(token: string, payload: BackdatedExpenseConfirmationPayload) {
      const [encodedClaims, encodedSignature, extra] = token.split(".");
      if (!encodedClaims || !encodedSignature || extra !== undefined) return false;
      let supplied: Buffer;
      let claims: SignedClaims;
      try {
        supplied = Buffer.from(encodedSignature, "base64url");
        claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")) as SignedClaims;
      } catch {
        return false;
      }
      const expected = signature(secret, encodedClaims);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
      if (!claims || typeof claims.expiresAt !== "string" || Date.parse(claims.expiresAt) <= Date.parse(now())) return false;
      return canonicalIntent(claims.payload) === canonicalIntent(payload);
    },
  });
}

export const BACKDATED_CONFIRMATION_VALIDITY_MS = VALIDITY_MS;
