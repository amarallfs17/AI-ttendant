import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { isValidSignature } from "./github.js";

const secret = "um-segredo-de-webhook";
const body = '{"ref":"refs/heads/main","repository":{"name":"contexto"}}';

function sign(payload: string, key = secret): string {
  return `sha256=${createHmac("sha256", key).update(payload).digest("hex")}`;
}

test("accepts a correctly signed payload", () => {
  assert.equal(isValidSignature(body, sign(body), secret), true);
});

test("rejects a payload signed with a different secret", () => {
  assert.equal(isValidSignature(body, sign(body, "outro-segredo"), secret), false);
});

// The whole point: a replayed signature must not authenticate new content.
test("rejects a body altered after signing", () => {
  const signature = sign(body);
  const tampered = body.replace("refs/heads/main", "refs/heads/evil");

  assert.equal(isValidSignature(tampered, signature, secret), false);
});

test("rejects a missing signature header", () => {
  assert.equal(isValidSignature(body, undefined, secret), false);
});

test("rejects a signature without the sha256 prefix", () => {
  const bare = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(isValidSignature(body, bare, secret), false);
});

test("rejects a signature of the wrong length without throwing", () => {
  // timingSafeEqual throws on length mismatch; the guard must catch it first.
  assert.doesNotThrow(() => isValidSignature(body, "sha256=abc", secret));
  assert.equal(isValidSignature(body, "sha256=abc", secret), false);
});

test("an empty body still verifies correctly", () => {
  assert.equal(isValidSignature("", sign(""), secret), true);
  assert.equal(isValidSignature("", sign("outro"), secret), false);
});
