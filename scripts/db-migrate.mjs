// Apply db/migrations/*.sql to the Neon database in DATABASE_URL.
//   npm run db:migrate            (reads DATABASE_URL from the environment or .env)
// Each file runs once, in name order, inside a transaction.
//
// Uses Neon's HTTP driver (plain HTTPS, so it works behind proxies and
// firewalls that block WebSockets or port 5432). DATABASE_DRIVER=pg targets a
// plain local Postgres instead.
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { neon } from "@neondatabase/serverless";

const root = join(import.meta.dirname, "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy it from the Neon console (Connection string).");
  process.exit(1);
}

/** Split a SQL file into statements, respecting quotes, $$ bodies and comments. */
function splitSql(text) {
  const out = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "-" && text[i + 1] === "-") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      cur += "\n";
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      cur += text.slice(i, end + 1);
      i = end;
    } else if (c === "$") {
      const tag = text.slice(i).match(/^\$[A-Za-z_]*\$/)?.[0];
      if (tag) {
        const end = text.indexOf(tag, i + tag.length);
        cur += text.slice(i, end + tag.length);
        i = end + tag.length - 1;
      } else cur += c;
    } else if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let run, transaction, close;
if (process.env.DATABASE_DRIVER === "pg") {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: url });
  run = async (text, params = []) => (await pool.query(text, params)).rows;
  transaction = async (stmts) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const [text, params] of stmts) await client.query(text, params);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  };
  close = () => pool.end();
} else {
  const sql = neon(url);
  run = (text, params = []) => sql.query(text, params);
  transaction = (stmts) => sql.transaction(stmts.map(([text, params]) => sql.query(text, params)));
  close = async () => {};
}

try {
  await run(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await run("select name from schema_migrations")).map((r) => r.name));
  const files = (await readdir(join(root, "db", "migrations"))).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    process.stdout.write(`Applying ${file}... `);
    const stmts = splitSql(await readFile(join(root, "db", "migrations", file), "utf8")).map((s) => [s, []]);
    stmts.push(["insert into schema_migrations (name) values ($1)", [file]]);
    await transaction(stmts);
    console.log("done");
  }
  console.log("Database is up to date.");
} finally {
  await close();
}
