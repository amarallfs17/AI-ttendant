import { readdir, readFile } from "node:fs/promises";

import type pg from "pg";

interface MigrationLogger {
  info: (message: string) => void;
}

// Advisory lock key so concurrent boots never apply the same migration twice.
const MIGRATION_LOCK_KEY = 727001;

export async function runMigrations(
  pool: pg.Pool,
  migrationsDir: URL,
  log: MigrationLogger,
): Promise<void> {
  await pool.query(
    `create table if not exists schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of files) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);

      const applied = await client.query(
        "select 1 from schema_migrations where name = $1",
        [name],
      );
      if (applied.rowCount === 0) {
        const sql = await readFile(new URL(name, migrationsDir), "utf8");
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [name]);
        log.info(`migration applied: ${name}`);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
