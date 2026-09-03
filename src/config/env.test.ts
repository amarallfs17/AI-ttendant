import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "./env.js";

const validSource = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/attendant",
  EVOLUTION_BASE_URL: "http://evolution:8080",
  EVOLUTION_API_KEY: "an-api-key",
  EVOLUTION_INSTANCE: "support",
};

test("parseEnv accepts a valid environment", () => {
  const env = parseEnv({ ...validSource, PORT: "3210" });
  assert.equal(env.PORT, 3210);
  assert.equal(env.DATABASE_URL, validSource.DATABASE_URL);
  assert.equal(env.EVOLUTION_BASE_URL, validSource.EVOLUTION_BASE_URL);
});

test("parseEnv applies the PORT default", () => {
  const env = parseEnv(validSource);
  assert.equal(env.PORT, 3000);
});

test("parseEnv rejects a missing DATABASE_URL naming the variable", () => {
  const withoutDatabase = { ...validSource, DATABASE_URL: undefined };
  assert.throws(() => parseEnv(withoutDatabase), /DATABASE_URL/);
});

test("parseEnv rejects a non-numeric PORT", () => {
  assert.throws(() => parseEnv({ ...validSource, PORT: "abc" }), /PORT/);
});

test("parseEnv reports every missing variable at once", () => {
  assert.throws(() => parseEnv({}), (error: unknown) => {
    const message = String(error);
    assert.match(message, /DATABASE_URL/);
    assert.match(message, /EVOLUTION_BASE_URL/);
    assert.match(message, /EVOLUTION_API_KEY/);
    assert.match(message, /EVOLUTION_INSTANCE/);
    return true;
  });
});

test("parseEnv rejects an EVOLUTION_BASE_URL that is not a URL", () => {
  assert.throws(
    () => parseEnv({ ...validSource, EVOLUTION_BASE_URL: "evolution:8080" }),
    /EVOLUTION_BASE_URL/,
  );
});

test("parseEnv rejects an EVOLUTION_BASE_URL with a trailing slash", () => {
  // Paths are concatenated directly, so a trailing slash would produce "//message".
  assert.throws(
    () => parseEnv({ ...validSource, EVOLUTION_BASE_URL: "http://evolution:8080/" }),
    /slash/,
  );
});
