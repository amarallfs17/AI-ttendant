import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "./env.js";

const validSource = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/attendant",
};

test("parseEnv accepts a valid environment", () => {
  const env = parseEnv({ ...validSource, PORT: "3210" });
  assert.equal(env.PORT, 3210);
  assert.equal(env.DATABASE_URL, validSource.DATABASE_URL);
});

test("parseEnv applies the PORT default", () => {
  const env = parseEnv(validSource);
  assert.equal(env.PORT, 3000);
});

test("parseEnv rejects a missing DATABASE_URL naming the variable", () => {
  assert.throws(() => parseEnv({}), /DATABASE_URL/);
});

test("parseEnv rejects a non-numeric PORT", () => {
  assert.throws(() => parseEnv({ ...validSource, PORT: "abc" }), /PORT/);
});
