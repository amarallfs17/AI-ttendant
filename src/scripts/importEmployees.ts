import { readFile } from "node:fs/promises";

import { parseEnv } from "../config/env.js";
import { createPool } from "../db/index.js";
import { upsertEmployeeFromCsv } from "../db/queries.js";
import { parseCsv } from "../logic/csv.js";
import { normalizeRawPhone } from "../logic/phone.js";

const REQUIRED_HEADERS = ["phone", "name", "department"] as const;

interface Report {
  inserted: number;
  updated: number;
  invalid: { line: number; reason: string }[];
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run import:employees -- <arquivo.csv>");
    process.exit(1);
  }

  const env = parseEnv(process.env);
  const { rows, headers } = parseCsv(await readFile(path, "utf8"));

  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    console.error(
      `Cabeçalho inválido. Faltam as colunas: ${missing.join(", ")}\n` +
        `Esperado: phone,name,department,email`,
    );
    process.exit(1);
  }

  const pool = createPool(env.DATABASE_URL);
  const report: Report = { inserted: 0, updated: 0, invalid: [] };

  try {
    for (const row of rows) {
      const phone = normalizeRawPhone(row.values.phone ?? "", env.DEFAULT_COUNTRY_CODE);
      const name = row.values.name ?? "";
      const department = row.values.department ?? "";

      if (!phone) {
        report.invalid.push({
          line: row.line,
          reason: `telefone inválido: "${row.values.phone ?? ""}"`,
        });
        continue;
      }
      if (!name || !department) {
        report.invalid.push({ line: row.line, reason: "nome ou setor vazio" });
        continue;
      }

      // One bad row must never cost the rest of the file.
      try {
        const outcome = await upsertEmployeeFromCsv(pool, {
          phone,
          name,
          department,
          email: row.values.email || null,
        });
        report[outcome] += 1;
      } catch (error) {
        report.invalid.push({
          line: row.line,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await pool.end();
  }

  console.log(
    `\nImportação concluída: ${report.inserted} inseridos, ` +
      `${report.updated} atualizados, ${report.invalid.length} inválidos.`,
  );
  for (const failure of report.invalid) {
    console.log(`  linha ${failure.line}: ${failure.reason}`);
  }

  // A file that produced nothing is a mistake worth failing on, not a silent
  // no-op the operator only notices later.
  if (report.inserted + report.updated === 0) {
    console.error("\nNenhuma linha aproveitada.");
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
