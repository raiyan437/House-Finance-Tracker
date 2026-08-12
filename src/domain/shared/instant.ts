import { DomainError } from "./domain-error";

declare const isoInstantBrand: unique symbol;

export type IsoInstant = string & {
  readonly [isoInstantBrand]: "IsoInstant";
};

const CANONICAL_ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isoInstant(value: string): IsoInstant {
  if (!CANONICAL_ISO_INSTANT.test(value)) {
    throw new DomainError(
      "INVALID_INSTANT",
      "A system timestamp must be a canonical UTC ISO instant.",
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new DomainError(
      "INVALID_INSTANT",
      "A system timestamp must be a real canonical UTC ISO instant.",
    );
  }

  return value as IsoInstant;
}
