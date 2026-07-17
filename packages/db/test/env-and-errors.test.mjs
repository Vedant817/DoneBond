import assert from "node:assert/strict";
import test from "node:test";

import {
  DatabaseServiceError,
  parseDatabaseEnvironment,
  translateDatabaseError
} from "../dist/index.js";

test("database environment fails closed and defaults to TLS", () => {
  assert.throws(() => parseDatabaseEnvironment({}), /DATABASE_URL/);
  assert.throws(
    () => parseDatabaseEnvironment({ DATABASE_URL: "mysql://localhost/donebond" }),
    /postgres/
  );
  const parsed = parseDatabaseEnvironment({
    DATABASE_URL: "postgresql://db.example.test/donebond"
  });
  assert.equal(parsed.DATABASE_SSL, "require");
  assert.equal(parsed.DATABASE_MAX_CONNECTIONS, 10);
  assert.throws(
    () =>
      parseDatabaseEnvironment({
        DATABASE_URL: "postgresql://db.example.test/donebond",
        DATABASE_SSL: "disable"
      }),
    /loopback/
  );
});

test("unique violations become stable errors without leaking constraint details", () => {
  const source = Object.assign(new Error("duplicate key contains sensitive row detail"), {
    code: "23505",
    constraint_name: "users_email_normalized_unique"
  });
  const translated = translateDatabaseError(source);
  assert(translated instanceof DatabaseServiceError);
  assert.equal(translated.code, "DB_CONFLICT");
  assert.equal(translated.message, "A record with the same identity already exists");
  assert.doesNotMatch(translated.message, /email|sensitive/i);
});

test("idempotency conflicts have a distinct stable code", () => {
  const error = new DatabaseServiceError(
    "DB_IDEMPOTENCY_CONFLICT",
    "The idempotency key was already used with different content"
  );
  assert.equal(translateDatabaseError(error), error);
  assert.equal(error.code, "DB_IDEMPOTENCY_CONFLICT");
});
