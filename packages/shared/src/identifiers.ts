import { z } from "zod";

import { EthereumAddressSchema, GitObjectIdSchema } from "./primitives.js";

const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;

export function normalizePublicIdentifier(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (value !== normalized || !IDENTIFIER_PATTERN.test(normalized)) {
    throw new TypeError(
      "Identifier must already be normalized lowercase ASCII with no surrounding whitespace"
    );
  }
  return normalized;
}

export function normalizeEthereumAddress(value: string): string {
  return EthereumAddressSchema.parse(value);
}

export function normalizeGitObjectId(value: string): string {
  return GitObjectIdSchema.parse(value);
}

export const PublicIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .transform(normalizePublicIdentifier);

export const ProjectSlugSchema = PublicIdentifierSchema;
