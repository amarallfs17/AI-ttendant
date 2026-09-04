import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { loadPrompt } from "./prompts.js";

async function promptDir(): Promise<URL> {
  const dir = await mkdtemp(path.join(tmpdir(), "prompts-"));
  return pathToFileURL(`${dir}/`);
}

test("falls back to the versioned example, so a fresh clone works", async () => {
  const dir = await promptDir();
  await writeFile(new URL("triage.example.md", dir), "exemplo generico");

  assert.equal(await loadPrompt("triage", dir), "exemplo generico");
});

test("prefers the local customisation when it exists", async () => {
  const dir = await promptDir();
  await writeFile(new URL("triage.example.md", dir), "exemplo generico");
  await writeFile(new URL("triage.md", dir), "conteudo interno da empresa");

  assert.equal(await loadPrompt("triage", dir), "conteudo interno da empresa");
});

test("fails loudly when neither file exists", async () => {
  const dir = await promptDir();
  await assert.rejects(() => loadPrompt("triage", dir));
});
