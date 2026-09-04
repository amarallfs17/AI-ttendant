import { readFile } from "node:fs/promises";

/**
 * Loads a prompt, preferring the maintainer's customised copy over the
 * versioned example (claude.md §9). The example is generic and functional, so
 * a fresh clone works before anyone writes a line of internal content.
 *
 * Read once at boot and kept in memory: re-reading per message would be I/O
 * for nothing.
 */
export async function loadPrompt(name: string, baseDir: URL): Promise<string> {
  const custom = new URL(`${name}.md`, baseDir);
  const example = new URL(`${name}.example.md`, baseDir);

  try {
    return await readFile(custom, "utf8");
  } catch {
    return await readFile(example, "utf8");
  }
}
