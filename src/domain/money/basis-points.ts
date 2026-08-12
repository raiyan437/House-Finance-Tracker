import { DomainError } from "../shared/domain-error";

declare const basisPointsBrand: unique symbol;

export type BasisPoints = number & {
  readonly [basisPointsBrand]: "BasisPoints";
};

export const FULL_PERCENTAGE_BASIS_POINTS = 10_000;
const PERCENTAGE_TEXT = /^\d+(?:\.\d{1,2})?$/;

export function basisPoints(value: number): BasisPoints {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > FULL_PERCENTAGE_BASIS_POINTS
  ) {
    throw new DomainError(
      "INVALID_BASIS_POINTS",
      "Basis points must be an integer from 0 through 10,000.",
    );
  }

  return value as BasisPoints;
}

export function parsePercentageToBasisPoints(value: string): BasisPoints {
  if (!PERCENTAGE_TEXT.test(value)) {
    throw new DomainError(
      "INVALID_PERCENTAGE_TEXT",
      "A percentage must be a plain non-negative decimal with at most two decimal places.",
    );
  }

  const [wholeText, fractionText = ""] = value.split(".");
  const parsed =
    BigInt(wholeText) * BigInt(100) +
    BigInt(fractionText.padEnd(2, "0") || "0");

  if (parsed > BigInt(FULL_PERCENTAGE_BASIS_POINTS)) {
    throw new DomainError(
      "INVALID_BASIS_POINTS",
      "A percentage cannot be greater than 100%.",
    );
  }

  return basisPoints(Number(parsed));
}
