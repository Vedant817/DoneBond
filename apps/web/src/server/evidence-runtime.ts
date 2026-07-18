import { DatabaseServiceError, DoneBondRepository } from "@donebond/db";
import { findResidualSecrets } from "@donebond/evidence";
import { ERROR_CODES, type CheckResult, type EvidenceBundle } from "@donebond/shared";

import { getCliTokenServices } from "./auth-runtime.ts";
import { CliTokenAuthenticator } from "./cli-token.ts";
import {
  createEvidenceHandlers,
  type EvidenceHandlerServices,
  type EvidenceStore
} from "./evidence-handlers.ts";
import { correlationId, errorResponse, HttpError } from "./http.ts";

let handlers: ReturnType<typeof createEvidenceHandlers> | undefined;
let repository: DoneBondRepository | undefined;
let authenticator: CliTokenAuthenticator | undefined;
let runtimeTokenSecret: string | undefined;
let runtimeApplicationOrigin: string | undefined;

export function assertEvidenceMatchesBinding(
  bundle: Pick<EvidenceBundle, "task" | "policy">,
  binding: { readonly taskHash: string; readonly policyHash: string }
): void {
  if (
    bundle.task.taskHash !== binding.taskHash ||
    bundle.policy.policyHash !== binding.policyHash
  ) {
    throw new HttpError(
      ERROR_CODES.EVIDENCE_HASH_MISMATCH,
      "Evidence task or policy commitment does not match the current record",
      409
    );
  }
}

export function assertNoResidualSecretsInChecks(checks: readonly CheckResult[]): void {
  const categories = new Set<string>();
  for (const check of checks) {
    for (const category of findResidualSecrets(check.stdout.preview)) categories.add(category);
    for (const category of findResidualSecrets(check.stderr.preview)) categories.add(category);
  }
  if (categories.size > 0) {
    throw new HttpError(
      ERROR_CODES.EVIDENCE_RESIDUAL_SECRET,
      `Residual high-confidence secret categories: ${[...categories].join(", ")}`,
      400
    );
  }
}

export function translateEvidenceDatabaseError(error: unknown): never {
  if (!(error instanceof DatabaseServiceError)) throw error;
  switch (error.code) {
    case "DB_IDEMPOTENCY_CONFLICT":
      throw new HttpError(
        ERROR_CODES.EVIDENCE_UPLOAD_CONFLICT,
        "The idempotency key was already used for a different request",
        409,
        { cause: error }
      );
    case "DB_NOT_FOUND":
      throw new HttpError(ERROR_CODES.EVIDENCE_NOT_FOUND, "Evidence was not found", 404, {
        cause: error
      });
    case "DB_INVALID_INPUT":
      throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, error.message, 400, {
        cause: error
      });
  }
  throw error;
}

async function databaseCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DatabaseServiceError) {
      translateEvidenceDatabaseError(error);
    }
    throw error;
  }
}

function initialize(): ReturnType<typeof createEvidenceHandlers> {
  if (handlers !== undefined) return handlers;
  const cliTokenServices = getCliTokenServices();

  runtimeApplicationOrigin = cliTokenServices.applicationOrigin;
  runtimeTokenSecret = cliTokenServices.tokenSecret;

  repository = cliTokenServices.accessStore;

  authenticator = new CliTokenAuthenticator(
    cliTokenServices.tokenSecret,
    {
      async useActiveCliToken(tokenDigest, expectedProjectPublicId, usedAt) {
        return cliTokenServices.tokenRepository.authenticate(
          expectedProjectPublicId,
          tokenDigest,
          usedAt
        );
      }
    },
    cliTokenServices.globalLimiter,
    cliTokenServices.tokenLimiter
  );

  const store: EvidenceStore = {
    async persistEvidence(input) {
      const binding = await databaseCall(() => repository!.findTaskBinding(input.taskPublicId));
      if (binding === null) {
        throw new HttpError(ERROR_CODES.EVIDENCE_NOT_FOUND, "Evidence task was not found", 404);
      }
      assertEvidenceMatchesBinding(input.bundle, binding);
      assertNoResidualSecretsInChecks(input.checks);
      const created = await databaseCall(() =>
        repository!.persistEvidence({
          actorScope: `cli-token:${input.submittedByTokenId}`,
          expiresAt: new Date(input.requestedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
          bundle: {
            taskId: binding.id,
            projectId: binding.projectId,
            policyId: binding.policyId,
            publicId: input.publicId,
            schemaVersion: input.bundle.schemaVersion,
            objectLocation: "database:evidence_bundles",
            evidenceHash: input.evidenceHash,
            commitHashDerived: input.commitHashDerived,
            gitObjectId: input.gitObjectId,
            passing: input.bundle.result.passing,
            bundleSizeBytes: input.bundleSizeBytes,
            submittedByTokenId: input.submittedByTokenId,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash
          },
          checks: input.checks.map((check) => ({
            checkKey: check.key,
            label: check.label,
            required: check.required,
            status: check.status,
            startedAt: new Date(check.startedAt),
            durationMs: check.durationMs,
            exitCode: check.exitCode,
            signal: check.signal ?? null,
            stdoutDigest: check.stdout.digest,
            stderrDigest: check.stderr.digest,
            stdoutPreview: check.stdout.preview.slice(0, 4096),
            stderrPreview: check.stderr.preview.slice(0, 4096)
          })),
          audit: {
            projectId: binding.projectId,
            taskId: binding.id,
            action: "evidence.uploaded",
            metadataSafeJson: {}
          }
        })
      );
      return {
        publicId: created.publicId,
        taskPublicId: input.taskPublicId,
        projectPublicId: input.projectPublicId,
        evidenceHash: created.evidenceHash,
        commitHashDerived: created.commitHashDerived,
        gitObjectId: created.gitObjectId,
        passing: created.passing,
        bundleSizeBytes: created.bundleSizeBytes,
        schemaVersion: created.schemaVersion,
        createdAt: created.createdAt
      };
    },
    async listEvidence(taskPublicId, page) {
      return databaseCall(() =>
        repository!.listEvidence(taskPublicId, {
          limit: page.limit,
          ...(page.cursor === null ? {} : { cursor: page.cursor })
        })
      );
    },
    async getEvidence(evidencePublicId) {
      return databaseCall(() => repository!.getEvidence(evidencePublicId));
    }
  };

  const services: EvidenceHandlerServices = {
    applicationOrigin: runtimeApplicationOrigin,
    resourceSecret: runtimeTokenSecret,
    authenticator,
    store
  };

  handlers = createEvidenceHandlers(services);
  return handlers;
}

export type EvidenceAction = keyof ReturnType<typeof createEvidenceHandlers>;

export async function dispatchEvidence(
  action: EvidenceAction,
  request: Request,
  primaryId?: string,
  secondaryId?: string
): Promise<Response> {
  try {
    const selected = initialize();
    switch (action) {
      case "submit":
        if (primaryId === undefined) throw new TypeError("Project ID is required");
        return selected.submit(request, primaryId);
      case "listEvidence":
        if (primaryId === undefined) throw new TypeError("Project ID is required");
        if (secondaryId === undefined) throw new TypeError("Task ID is required");
        return selected.listEvidence(request, primaryId, secondaryId);
      case "getEvidence":
        if (primaryId === undefined) throw new TypeError("Evidence ID is required");
        return selected.getEvidence(request, primaryId);
    }
  } catch (error) {
    return errorResponse(error, correlationId(request));
  }
}
