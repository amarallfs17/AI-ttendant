import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "./env.js";

const validSource = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/attendant",
  EVOLUTION_BASE_URL: "http://evolution:8080",
  EVOLUTION_API_KEY: "an-api-key",
  EVOLUTION_INSTANCE: "support",
  AI_API_KEY: "an-ai-key",
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

test("parseEnv defaults the AI provider and model", () => {
  const env = parseEnv(validSource);
  assert.equal(env.AI_PROVIDER, "gemini");
  assert.equal(env.AI_MODEL, "gemini-3.8-flash");
});

test("parseEnv rejects an unknown AI provider", () => {
  assert.throws(() => parseEnv({ ...validSource, AI_PROVIDER: "openai" }), /AI_PROVIDER/);
});

test("parseEnv requires an AI key", () => {
  assert.throws(() => parseEnv({ ...validSource, AI_API_KEY: undefined }), /AI_API_KEY/);
});

test("parseEnv rejects an EVOLUTION_BASE_URL with a trailing slash", () => {
  // Paths are concatenated directly, so a trailing slash would produce "//message".
  assert.throws(
    () => parseEnv({ ...validSource, EVOLUTION_BASE_URL: "http://evolution:8080/" }),
    /slash/,
  );
});

// A `.env` file writes an unused optional variable as `VAR=`. Treating that as
// a present-but-empty value made the process refuse to boot over a variable
// nobody wanted.
test("an empty optional variable means unset, not invalid", () => {
  const env = parseEnv({
    ...validSource,
    GITHUB_WEBHOOK_SECRET: "",
    CONTEXT_MD_URL: "",
    CONTEXT_MD_TOKEN: "   ",
  });

  assert.equal(env.GITHUB_WEBHOOK_SECRET, undefined);
  assert.equal(env.CONTEXT_MD_URL, undefined);
  assert.equal(env.CONTEXT_MD_TOKEN, undefined);
});

test("an empty required variable is still an error", () => {
  assert.throws(() => parseEnv({ ...validSource, DATABASE_URL: "" }), /DATABASE_URL/);
});

test("a variable left empty falls back to its default", () => {
  const env = parseEnv({ ...validSource, AI_MODEL: "", PORT: "" });
  assert.equal(env.AI_MODEL, "gemini-3.8-flash");
  assert.equal(env.PORT, 3000);
});
