import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";

import { ApiErrorSchema, ERROR_CODES, type ApiError, type ErrorCode } from "@donebond/shared";

const CORRELATION_ID = /^[A-Za-z0-9._-]{8,128}$/u;
const JSON_CONTENT_TYPE = /^application\/(?:[A-Za-z0-9.+-]+\+)?json(?:\s*;|$)/iu;

export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly fieldErrors?: ApiError["error"]["fieldErrors"];

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    options: {
      readonly retryable?: boolean;
      readonly fieldErrors?: ApiError["error"]["fieldErrors"];
      readonly cause?: unknown;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "HttpError";
    this.code = code;
    this.status = status;
    this.retryable = options.retryable ?? false;
    this.fieldErrors = options.fieldErrors;
  }
}

export function correlationId(request: Request): string {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return supplied !== undefined && CORRELATION_ID.test(supplied) ? supplied : randomUUID();
}

function responseHeaders(id: string): HeadersInit {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-correlation-id": id
  };
}

export function jsonResponse(value: unknown, status: number, id: string): Response {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders(id) });
}

export function errorResponse(error: unknown, id: string): Response {
  const known = error instanceof HttpError ? error : undefined;
  const body = ApiErrorSchema.parse({
    error: {
      code: known?.code ?? ERROR_CODES.INTERNAL_ERROR,
      message: known?.message ?? "The request could not be completed",
      correlationId: id,
      retryable: known?.retryable ?? false,
      ...(known?.fieldErrors === undefined ? {} : { fieldErrors: known.fieldErrors })
    }
  });
  return jsonResponse(body, known?.status ?? 500, id);
}

export async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be a positive safe integer");
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    throw new HttpError(ERROR_CODES.INVALID_CONTENT_TYPE, "Expected an application/json body", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      throw new HttpError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        "Request body exceeds the size limit",
        413
      );
    }
  }
  if (request.body === null) {
    throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "A JSON body is required", 400);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new HttpError(
          ERROR_CODES.PAYLOAD_TOO_LARGE,
          "Request body exceeds the size limit",
          413
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk)),
        total
      )
    );
  } catch (cause) {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "Request body is not valid UTF-8",
      400,
      { cause }
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch (cause) {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "Request body is not valid JSON",
      400,
      {
        cause
      }
    );
  }
}

export function requireTrustedOrigin(request: Request, applicationOrigin: string): void {
  let expected: URL;
  let actual: URL;
  const actualHeader = request.headers.get("origin") ?? "";
  try {
    expected = new URL(applicationOrigin);
    actual = new URL(actualHeader);
  } catch {
    throw new HttpError(ERROR_CODES.AUTH_CSRF_INVALID, "Request origin is missing or invalid", 403);
  }
  if (
    applicationOrigin !== expected.origin ||
    actualHeader !== actual.origin ||
    expected.origin !== actual.origin
  ) {
    throw new HttpError(ERROR_CODES.AUTH_CSRF_INVALID, "Request origin is not trusted", 403);
  }
}
