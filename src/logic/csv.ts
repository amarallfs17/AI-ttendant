export interface CsvRow {
  /** 1-based line in the file, so the report can point at the offending row. */
  line: number;
  values: Record<string, string>;
}

/**
 * Minimal CSV reader for the employee roster: a header row, commas, and quoted
 * fields. Not a general parser — the files are the maintainer's own exports
 * (claude.md §3, a dependency must earn its place).
 */
export function parseCsv(content: string): {
  rows: CsvRow[];
  headers: string[];
} {
  const lines = content
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter((entry) => entry.text.trim() !== "");

  const first = lines.shift();
  if (!first) {
    return { rows: [], headers: [] };
  }

  const headers = splitLine(first.text).map((header) => header.trim().toLowerCase());

  const rows = lines.map((entry) => {
    const cells = splitLine(entry.text);
    const values: Record<string, string> = {};
    headers.forEach((header, index) => {
      values[header] = (cells[index] ?? "").trim();
    });
    return { line: entry.line, values };
  });

  return { rows, headers };
}

function splitLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === "," || char === ";") {
      cells.push(current);
      current = "";
    } else {
      current += char ?? "";
    }
  }

  cells.push(current);
  return cells;
}
