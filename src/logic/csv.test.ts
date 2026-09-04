import assert from "node:assert/strict";
import test from "node:test";

import { parseCsv } from "./csv.js";

test("reads the header and rows", () => {
  const { headers, rows } = parseCsv("phone,name\n5511,Ana\n5522,Bruno\n");

  assert.deepEqual(headers, ["phone", "name"]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0]?.values, { phone: "5511", name: "Ana" });
});

test("reports the line number of each row for the import report", () => {
  const { rows } = parseCsv("phone,name\n5511,Ana\n\n5522,Bruno\n");

  assert.equal(rows[0]?.line, 2);
  assert.equal(rows[1]?.line, 4, "blank lines still count towards the file position");
});

test("keeps commas inside quoted fields", () => {
  const { rows } = parseCsv('phone,name\n5511,"Dias, Eduardo"\n');
  assert.equal(rows[0]?.values.name, "Dias, Eduardo");
});

test("unescapes a doubled quote", () => {
  const { rows } = parseCsv('phone,name\n5511,"Ana ""Aninha"" Souza"\n');
  assert.equal(rows[0]?.values.name, 'Ana "Aninha" Souza');
});

test("accepts semicolons, as exported by spreadsheets in pt-BR locales", () => {
  const { rows } = parseCsv("phone;name\n5511;Ana\n");
  assert.deepEqual(rows[0]?.values, { phone: "5511", name: "Ana" });
});

test("fills missing trailing columns with empty strings", () => {
  const { rows } = parseCsv("phone,name,email\n5511,Ana\n");
  assert.equal(rows[0]?.values.email, "");
});

test("lowercases headers so casing in the file does not matter", () => {
  const { headers } = parseCsv("Phone,NAME\n5511,Ana\n");
  assert.deepEqual(headers, ["phone", "name"]);
});

test("handles CRLF line endings", () => {
  const { rows } = parseCsv("phone,name\r\n5511,Ana\r\n");
  assert.equal(rows[0]?.values.name, "Ana");
});

test("an empty file yields nothing instead of throwing", () => {
  assert.deepEqual(parseCsv(""), { rows: [], headers: [] });
});
