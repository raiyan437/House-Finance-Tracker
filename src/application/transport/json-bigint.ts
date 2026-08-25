/**
 * JSON transport for view payloads that may contain BigInt financial
 * intermediates (e.g., signed month-change basis points). Both sides of the
 * trusted same-origin boundary use this exact tagged encoding; values never
 * lose precision and no float coercion ever occurs.
 */
const BIGINT_TAG = "\u0000__hft-bigint:";

export function serializeWithBigInt(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? `${BIGINT_TAG}${item.toString()}` : item,
  );
}

export function parseWithBigInt<T>(text: string): T {
  return JSON.parse(text, (_key, item) => {
    if (typeof item === "string" && item.startsWith(BIGINT_TAG)) {
      return BigInt(item.slice(BIGINT_TAG.length));
    }
    return item;
  }) as T;
}
