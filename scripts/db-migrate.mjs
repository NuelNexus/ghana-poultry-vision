// Apply db/migrations/*.sql to the Neon database in DATABASE_URL.
//   DATABASE_URL=postgres://... npm run db:migrate
// Each file runs once, in name order, inside a transaction.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { Pool as NeonPool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy it from the Neon console (Connection string).");
  process.exit(1);
}

const dir = join(import.meta.dirname, "..", "db", "migrations");
// DATABASE_DRIVER=pg targets a plain local Postgres instead of Neon.
const Pool = process.env.DATABASE_DRIVER === "pg" ? (await import("pg")).default.Pool : NeonPool;
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const { rows } = await client.query("select name from schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    process.stdout.write(`Applying ${file}... `);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log("done");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }
  console.log("Database is up to date.");
} finally {
  client.release();
  await pool.end();
}
