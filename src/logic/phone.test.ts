import assert from "node:assert/strict";
import test from "node:test";

import { normalizePhone, normalizeRawPhone } from "./phone.js";

test("normalizePhone strips the JID suffix", () => {
  assert.equal(normalizePhone("5511999990001@s.whatsapp.net"), "5511999990001");
});

test("normalizePhone rejects JIDs that carry no phone number", () => {
  assert.equal(normalizePhone("182736451@lid"), null);
  assert.equal(normalizePhone("123-160@g.us"), null);
  assert.equal(normalizePhone("5511999990001"), null);
  assert.equal(normalizePhone("@s.whatsapp.net"), null);
});

const BR = "55";

test("adds the country code to a national number", () => {
  assert.equal(normalizeRawPhone("37999718888", BR), "5537999718888");
});

test("accepts the common spreadsheet formats", () => {
  for (const raw of [
    "(37) 99971-8888",
    "37 99971 8888",
    "37.99971.8888",
    " 37999718888 ",
  ]) {
    assert.equal(normalizeRawPhone(raw, BR), "5537999718888", raw);
  }
});

test("keeps a number that already carries the country code", () => {
  assert.equal(normalizeRawPhone("5537999718888", BR), "5537999718888");
  assert.equal(normalizeRawPhone("+55 (37) 99971-8888", BR), "5537999718888");
});

test("drops a leading zero used for local dialling", () => {
  assert.equal(normalizeRawPhone("037999718888", BR), "5537999718888");
});

test("accepts a landline with eight subscriber digits", () => {
  assert.equal(normalizeRawPhone("3733214567", BR), "553733214567");
});

// Area code 55 (Santa Maria/RS) looks exactly like the +55 country code, so a
// prefix-based rule would leave this number unreachable.
test("treats area code 55 as a national number, not a country code", () => {
  assert.equal(normalizeRawPhone("55999887766", BR), "5555999887766");
});

test("rejects numbers too short to dial", () => {
  assert.equal(normalizeRawPhone("99971-8888", BR), null, "no area code");
  assert.equal(normalizeRawPhone("1234", BR), null);
  assert.equal(normalizeRawPhone("", BR), null);
  assert.equal(normalizeRawPhone("sem numero", BR), null);
});

test("rejects numbers longer than E.164 allows", () => {
  assert.equal(normalizeRawPhone("1234567890123456", BR), null);
});

test("works with another country code", () => {
  assert.equal(normalizeRawPhone("(555) 123-4567", "1"), "15551234567");
});
