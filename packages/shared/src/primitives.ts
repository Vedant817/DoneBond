import { getAddress, isAddress } from "viem";
import { z } from "zod";

const BYTES_32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ETHEREUM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const DECIMAL_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;

export const Bytes32Schema = z
  .string()
  .regex(BYTES_32_PATTERN, "Expected a 0x-prefixed 32-byte hexadecimal value")
  .transform((value) => value.toLowerCase());

export const EthereumAddressSchema = z
  .string()
  .trim()
  .regex(ETHEREUM_ADDRESS_PATTERN, "Expected a 20-byte Ethereum address")
  .refine((value) => {
    const body = value.slice(2);
    const mixedCase = /[a-f]/.test(body) && /[A-F]/.test(body);
    return isAddress(value, { strict: mixedCase });
  }, "Invalid Ethereum checksum")
  .transform((value) => getAddress(value).toLowerCase());

export const NonZeroEthereumAddressSchema = EthereumAddressSchema.refine(
  (value) => value !== "0x0000000000000000000000000000000000000000",
  "Zero address is not allowed"
);

export const GitObjectIdSchema = z
  .string()
  .trim()
  .regex(GIT_OBJECT_ID_PATTERN, "Expected exactly a 40- or 64-character Git object ID")
  .transform((value) => value.toLowerCase());

export const DecimalWeiSchema = z
  .string()
  .regex(DECIMAL_INTEGER_PATTERN, "Expected a non-negative base-10 integer string");

export const Uint64StringSchema = DecimalWeiSchema.refine(
  (value) => BigInt(value) <= 18_446_744_073_709_551_615n,
  "Value exceeds uint64"
);

export const NormalizedTextSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.normalize("NFC"));

export const SafeRepositoryUrlSchema = z
  .string()
  .url()
  .max(2048)
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      context.addIssue({ code: "custom", message: "Repository URL must use HTTP(S)" });
    }
    if (url.username || url.password) {
      context.addIssue({ code: "custom", message: "Repository URL must not contain credentials" });
    }
  });

export const RepositoryIdentitySchema = z
  .string()
  .max(1024)
  .regex(
    /^github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/i,
    "Expected a GitHub host/owner/repository identity"
  )
  .transform((value) => value.toLowerCase().replace(/\.git$/, ""));

export const HexSignatureSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/, "Expected a 65-byte signature")
  .transform((value) => value.toLowerCase());

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export type Bytes32 = z.infer<typeof Bytes32Schema>;
export type EthereumAddress = z.infer<typeof EthereumAddressSchema>;
export type GitObjectId = z.infer<typeof GitObjectIdSchema>;
export type DecimalWei = z.infer<typeof DecimalWeiSchema>;
