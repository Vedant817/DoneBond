/**
 * Pure hash-formatting logic for the HashDisplay primitive.
 *
 * The product surfaces a lot of 0x-prefixed 32-byte hex hashes (task hash,
 * policy hash, evidence hash, commit hash, transaction hash). Humans should
 * never have to read or select a full 66-character hash to know what it is,
 * but the full value must stay reachable (title attribute, copy button).
 */

export interface TruncateHashOptions {
  /** Characters kept from the start, including any "0x" prefix. */
  head?: number;
  /** Characters kept from the end. */
  tail?: number;
  /** Separator inserted between head and tail when truncating. */
  ellipsis?: string;
}

const DEFAULT_HEAD = 6;
const DEFAULT_TAIL = 4;
const DEFAULT_ELLIPSIS = "…";

/**
 * Truncates a long hash-like string to a readable "0x1234…abcd" form.
 * Values that are already short enough are returned unchanged -- truncation
 * must never make a short value longer.
 */
export function truncateHash(value: string, options: TruncateHashOptions = {}): string {
  const head = options.head ?? DEFAULT_HEAD;
  const tail = options.tail ?? DEFAULT_TAIL;
  const ellipsis = options.ellipsis ?? DEFAULT_ELLIPSIS;

  if (head < 0 || tail < 0) {
    throw new RangeError("head and tail must be non-negative");
  }

  if (value.length <= head + tail + ellipsis.length) {
    return value;
  }

  return `${value.slice(0, head)}${ellipsis}${value.slice(value.length - tail)}`;
}

/** True for a 0x-prefixed, even-length hex string (loose check -- display only, not a validator). */
export function looksLikeHexHash(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}
