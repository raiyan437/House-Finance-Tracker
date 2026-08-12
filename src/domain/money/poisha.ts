import { DomainError } from "../shared/domain-error";

declare const poishaBrand: unique symbol;
declare const positivePoishaBrand: unique symbol;

export type Poisha = number & { readonly [poishaBrand]: "Poisha" };
export type PositivePoisha = Poisha & {
  readonly [positivePoishaBrand]: "PositivePoisha";
};

const MAX_SAFE_POISHA = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_POISHA = BigInt(Number.MIN_SAFE_INTEGER);
const MONEY_TEXT = /^\d+(?:\.\d{1,2})?$/;

export function poisha(value: number): Poisha {
  if (!Number.isSafeInteger(value)) {
    throw new DomainError(
      "INVALID_POISHA",
      "Poisha must be represented by a safe integer.",
    );
  }

  return value as Poisha;
}

export function positivePoisha(value: number): PositivePoisha {
  const amount = poisha(value);

  if (amount <= 0) {
    throw new DomainError(
      "NON_POSITIVE_EXPENSE_AMOUNT",
      "An expense amount must be greater than zero poisha.",
    );
  }

  return amount as PositivePoisha;
}

export function poishaFromBigInt(value: bigint): Poisha {
  if (value < MIN_SAFE_POISHA || value > MAX_SAFE_POISHA) {
    throw new DomainError(
      "MONEY_OVERFLOW",
      "The poisha value exceeds the safe integer range.",
    );
  }

  return poisha(Number(value));
}

export function parseBdtToPoisha(value: string): Poisha {
  if (!MONEY_TEXT.test(value)) {
    throw new DomainError(
      "INVALID_MONEY_TEXT",
      "Money must be a plain non-negative decimal with at most two decimal places.",
    );
  }

  const [takaText, fractionText = ""] = value.split(".");
  const paddedFraction = fractionText.padEnd(2, "0");
  const parsed =
    BigInt(takaText) * BigInt(100) + BigInt(paddedFraction || "0");

  return poishaFromBigInt(parsed);
}

export function formatCanonicalBdt(value: Poisha): string {
  const exactValue = BigInt(value);
  const sign = exactValue < BigInt(0) ? "-" : "";
  const absoluteValue = exactValue < BigInt(0) ? -exactValue : exactValue;
  const taka = absoluteValue / BigInt(100);
  const fraction = absoluteValue % BigInt(100);

  return `${sign}${taka}.${fraction.toString().padStart(2, "0")}`;
}

export function sumPoisha(values: readonly Poisha[]): Poisha {
  const total = values.reduce(
    (sum, value) => sum + BigInt(value),
    BigInt(0),
  );
  return poishaFromBigInt(total);
}
