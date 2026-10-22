import process from "node:process";
import { neon, types as pgTypes } from "@neondatabase/serverless";

// Neon Postgres access. Server-only: the .server.ts suffix keeps this (and
// DATABASE_URL) out of the browser bundle.
//
// All queries go through `query(text, params)` with $1-style placeholders.
// Set DATABASE_URL to the Neon connection string. For offline development
// against a local Postgres, set DATABASE_DRIVER=pg as well (uses the `pg`
// dev dependency instead of Neon's HTTP driver).

const NUMERIC = 1700,
  INT8 = 20,
  TIMESTAMP = 1114,
  TIMESTAMPTZ = 1184,
  DATE = 1082;

// Postgres "2026-10-01 22:10:43.838+00" -> ISO 8601, which every browser parses.
const toIso = (v: string) => {
  const s = v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
};

function parserFor(id: number, fallback: (id: number, format?: "text" | "binary") => unknown) {
  if (id === NUMERIC || id === INT8) return (v: string) => (v == null ? null : Number(v));
  if (id === TIMESTAMP || id === TIMESTAMPTZ) return toIso;
  if (id === DATE) return (v: string) => v;
  return fallback(id);
}

const customTypes = {
  getTypeParser: (id: number, format?: "text" | "binary") =>
    parserFor(id, (i) => pgTypes.getTypeParser(i, format)),
};

type Runner = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
let runner: Runner | undefined;

async function getRunner(): Promise<Runner> {
  if (runner) return runner;
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is not set. Add your Neon connection string to the environment.");

  if (process.env.DATABASE_DRIVER === "pg") {
    const mod = "pg";
    const { default: pg } = await import(/* @vite-ignore */ mod);
    const pool = new pg.Pool({ connectionString: url });
    const pgCustom = {
      getTypeParser: (id: number, format?: "text" | "binary") =>
        parserFor(id, (i) => pg.types.getTypeParser(i, format)),
    };
    runner = async (text, params) =>
      (await pool.query({ text, values: params, types: pgCustom })).rows;
  } else {
    const sql = neon(url);
    // Neon's HTTP driver ignores `types` passed to neon(); it only honours the
    // per-query option. Without this, timestamptz arrives as a Date and
    // numeric as a string.
    runner = (text, params) =>
      sql.query(text, params, { types: customTypes }) as Promise<Record<string, unknown>[]>;
  }
  return runner;
}

// Belt and braces: whatever the driver does, no Date object ever leaves the
// server. Timestamps are ISO strings, matching src/lib/api/types.ts.
function normalizeRow(row: Record<string, unknown>) {
  for (const k in row) {
    const v = row[k];
    if (v instanceof Date) row[k] = Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  return row;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const run = await getRunner();
  const rows = await run(text, params);
  return rows.map(normalizeRow) as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
