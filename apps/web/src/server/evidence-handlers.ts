import { canonicalKeccak256 } from "@donebond/evidence";
import {
  ERROR_CODES,
  EvidenceBundleSchema,
  PublicIdentifierSchema,
  type EvidenceBundle,
  type CheckResult
} from "@donebond/shared";

import { deriveOpaquePublicId } from "./cli-token.ts";
import {
  correlationId,
  errorResponse,
  HttpError,
  jsonResponse,
  readBoundedJson,
  requireTrustedOrigin
} from "./http.ts";
import type { CliTokenAuthenticator, CliTokenPrincipal } from "./cli-token.ts";

const OPAQUE_PUBLIC_ID = /^[0-9a-hjkmnp-tv-z]{26}$/u;

export interface EvidenceRecord {
  readonly publicId: string;
  readonly taskPublicId: string;
  readonly projectPublicId: string;
  readonly evidenceHash: string;
  readonly commitHashDerived: string;
  readonly gitObjectId: string;
  readonly passing: boolean;
  readonly bundleSizeBytes: number;
  readonly schemaVersion: number;
  readonly createdAt: Date | string;
}

export interface EvidenceDetailRecord extends EvidenceRecord {
  readonly checks: readonly CheckRecord[];
}

export interface CheckRecord {
  readonly checkKey: string;
  readonly label: string;
  readonly required: boolean;
  readonly status: string;
  readonly startedAt: Date | string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly stdoutPreview: string;
  readonly stderrPreview: string;
}

export interface EvidenceListCursor {
  readonly createdAt: Date;
  readonly publicId: string;
}

export interface EvidenceStore {
  persistEvidence(input: {
    readonly taskPublicId: string;
    readonly projectPublicId: string;
    readonly publicId: string;
    readonly bundle: EvidenceBundle;
    readonly evidenceHash: string;
    readonly commitHashDerived: string;
    readonly gitObjectId: string;
    readonly checks: readonly CheckResult[];
    readonly bundleSizeBytes: number;
    readonly submittedByTokenId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestedAt: Date;
  }): Promise<EvidenceRecord>;
  listEvidence(
    taskPublicId: string,
    page: { readonly cursor: EvidenceListCursor | null; readonly limit: number }
  ): Promise<{
    readonly items: readonly EvidenceRecord[];
    readonly nextCursor: EvidenceListCursor | null;
  }>;
  getEvidence(evidencePublicId: string): Promise<EvidenceDetailRecord | null>;
}

export interface EvidenceHandlerServices {
  readonly applicationOrigin: string;
  readonly resourceSecret: string;
  readonly authenticator: CliTokenAuthenticator;
  readonly store: EvidenceStore;
}

function publicId(value: string): string {
  if (!OPAQUE_PUBLIC_ID.test(value)) {
    throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Public ID is malformed", 400);
  }
  return value;
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (key === null || !/^[A-Za-z0-9._:-]{16,128}$/u.test(key)) {
    throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Idempotency-Key is required", 400);
  }
  return key;
}

function requireNoQuery(request: Request): void {
  if (new URL(request.url).searchParams.toString() !== "") {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "Query parameters are not allowed on a mutation endpoint",
      400
    );
  }
}

function parsePage(request: Request): { cursor: EvidenceListCursor | null; limit: number } {
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (key !== "cursor" && key !== "limit") {
      throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Unknown pagination field", 400);
    }
  }
  const limitValue = url.searchParams.get("limit") ?? "25";
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue)) {
    throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "limit must be from 1 to 100", 400);
  }
  const suppliedCursor = url.searchParams.get("cursor");
  if (suppliedCursor === null) return { cursor: null, limit: Number(limitValue) };
  try {
    const decoded = JSON.parse(
      Buffer.from(suppliedCursor, "base64url").toString("utf8")
    ) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded) ||
      Object.keys(decoded).length !== 2 ||
      !("createdAt" in decoded) ||
      !("publicId" in decoded) ||
      typeof decoded.createdAt !== "string" ||
      typeof decoded.publicId !== "string"
    ) {
      throw new TypeError("Malformed cursor");
    }
    const createdAt = new Date(decoded.createdAt);
    if (!Number.isFinite(createdAt.getTime())) throw new TypeError("Malformed cursor date");
    return {
      cursor: { createdAt, publicId: publicId(decoded.publicId) },
      limit: Number(limitValue)
    };
  } catch (cause) {
    throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "cursor is invalid", 400, {
      cause
    });
  }
}

function encodeCursor(cursor: EvidenceListCursor | null): string | null {
  return cursor === null
    ? null
    : Buffer.from(
        JSON.stringify({ createdAt: cursor.createdAt.toISOString(), publicId: cursor.publicId }),
        "utf8"
      ).toString("base64url");
}

function parseEvidenceSubmitInput(value: unknown): {
  readonly evidence: EvidenceBundle;
  readonly evidenceHash: `0x${string}`;
} {
  const parsed = EvidenceBundleSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      parsed.error.issues[0]?.message ?? "Evidence bundle does not match the schema",
      400
    );
  }
  const evidenceHash = canonicalKeccak256(parsed.data);
  return { evidence: parsed.data, evidenceHash };
}

function evidenceDto(record: EvidenceRecord) {
  const normalizedPublicId = PublicIdentifierSchema.parse(record.publicId);
  if (!OPAQUE_PUBLIC_ID.test(normalizedPublicId)) {
    throw new TypeError("Persisted evidence public ID is invalid");
  }
  return {
    publicId: normalizedPublicId,
    taskPublicId: PublicIdentifierSchema.parse(record.taskPublicId),
    projectPublicId: PublicIdentifierSchema.parse(record.projectPublicId),
    evidenceHash: record.evidenceHash,
    commitHashDerived: record.commitHashDerived,
    gitObjectId: record.gitObjectId,
    passing: record.passing,
    bundleSizeBytes: record.bundleSizeBytes,
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt
  };
}

function evidenceDetailDto(record: EvidenceDetailRecord) {
  return {
    ...evidenceDto(record),
    checks: record.checks.map((check) => ({
      checkKey: check.checkKey,
      label: check.label,
      required: check.required,
      status: check.status,
      startedAt: check.startedAt instanceof Date ? check.startedAt.toISOString() : check.startedAt,
      durationMs: check.durationMs,
      exitCode: check.exitCode,
      signal: check.signal,
      stdoutDigest: check.stdoutDigest,
      stderrDigest: check.stderrDigest,
      stdoutPreview: check.stdoutPreview,
      stderrPreview: check.stderrPreview
    }))
  };
}

export function createEvidenceHandlers(services: EvidenceHandlerServices) {
  const now = () => new Date();

  async function authenticate(
    request: Request,
    projectPublicId: string
  ): Promise<CliTokenPrincipal> {
    requireTrustedOrigin(request, services.applicationOrigin);
    const authorization = request.headers.get("authorization");
    return services.authenticator.authenticate(authorization, projectPublicId);
  }

  return {
    submit: async (request: Request, projectPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const bi = projectPublicId;
        const body = await readBoundedJson(request, 524_288);
        const bodyRecord =
          typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
        const input = parseEvidenceSubmitInput(
          "evidence" in bodyRecord ? bodyRecord.evidence : body
        );
        const key = idempotencyKey(request);
        const principal = await authenticate(request, bi);
        const reqHash = canonicalKeccak256({
          kind: "donebond.evidence-submit",
          evidenceHash: input.evidenceHash,
          idempotencyKey: key
        });
        const bundleSize = Buffer.byteLength(JSON.stringify(input.evidence), "utf8");
        const evidencePublicId = deriveOpaquePublicId(services.resourceSecret, "evidence", [
          principal.tokenPublicId,
          key
        ]);
        const persisted = await services.store.persistEvidence({
          taskPublicId: input.evidence.task.publicId,
          projectPublicId: bi,
          publicId: evidencePublicId,
          bundle: input.evidence,
          evidenceHash: input.evidenceHash,
          commitHashDerived: input.evidence.git.derivedCommitHash,
          gitObjectId: input.evidence.git.objectId,
          checks: input.evidence.checks,
          bundleSizeBytes: bundleSize,
          submittedByTokenId: principal.tokenId,
          idempotencyKey: key,
          requestHash: reqHash,
          requestedAt: now()
        });
        return jsonResponse({ evidence: evidenceDto(persisted) }, 201, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    listEvidence: async (
      request: Request,
      projectPublicId: string,
      taskPublicId: string
    ): Promise<Response> => {
      const id = correlationId(request);
      try {
        await authenticate(request, projectPublicId);
        const page = parsePage(request);
        const result = await services.store.listEvidence(taskPublicId, page);
        return jsonResponse(
          {
            items: result.items.map(evidenceDto),
            nextCursor: encodeCursor(result.nextCursor)
          },
          200,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    getEvidence: async (request: Request, evidencePublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const record = await services.store.getEvidence(evidencePublicId);
        if (record === null) {
          throw new HttpError(ERROR_CODES.EVIDENCE_NOT_FOUND, "Evidence was not found", 404);
        }
        return jsonResponse({ evidence: evidenceDetailDto(record) }, 200, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    }
  };
}
