import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(
  authorization: string | null,
  secret: string | undefined
): boolean {
  if (!secret || secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
