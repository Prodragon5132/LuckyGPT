import "server-only";
import path from "node:path";
import fs from "node:fs";
import { dataDir, isVercel } from "./env";
import { MIGRATIONS } from "./schema";

/**
 * Tiny database layer. Uses real Postgres when DATABASE_URL is set (e.g. Neon,
 * Supabase, Docker postgres) and falls back to PGlite (Postgres compiled to
 * WebAssembly, stored in ./data/db) so the app runs locally with zero setup.
 */

type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface Driver extends Queryable {
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

async function createPgDriver(url: string): Promise<Driver> {
  const { Pool } = await import("pg");
  const needsSsl = !/localhost|127\.0\.0\.1|sslmode=disable/.test(url) && !/\bpostgres:5432\b/.test(url);
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_SIZE || 5),
    ssl: needsSsl ? { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "1" } : undefined,
    idleTimeoutMillis: 20_000,
  });
  pool.on("error", (err) => console.error("[db] pool error", err.message));
  return {
    async query<T extends Row>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          async query<R extends Row>(sql: string, params: unknown[] = []) {
            const res = await client.query(sql, params as unknown[]);
            return res.rows as R[];
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

async function createPgliteDriver(): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.join(dataDir(), "db");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = await PGlite.create(dir);
  // PGlite is single-connection; serialize access to keep transactions isolated.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  return {
    query<T extends Row>(sql: string, params: unknown[] = []) {
      return serial(async () => (await db.query<T>(sql, params as unknown[])).rows);
    },
    exec(sql: string) {
      return serial(async () => {
        await db.exec(sql);
      });
    },
    tx<T>(fn: (q: Queryable) => Promise<T>) {
      return serial(() =>
        db.transaction(async (tx) =>
          fn({
            async query<R extends Row>(sql: string, params: unknown[] = []) {
              return (await tx.query<R>(sql, params as unknown[])).rows;
            },
          }),
        ),
      );
    },
  };
}

async function migrate(driver: Driver) {
  await driver.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)`);
  const rows = await driver.query<{ version: number }>(`SELECT version FROM schema_migrations`);
  const applied = new Set(rows.map((r) => Number(r.version)));
  for (const [i, sql] of MIGRATIONS.entries()) {
    const version = i + 1;
    if (applied.has(version)) continue;
    await driver.tx(async (q) => {
      // Guard against two cold-starting server instances migrating at once.
      const exists = await q.query(`SELECT 1 FROM schema_migrations WHERE version = $1`, [version]);
      if (exists.length) return;
      for (const statement of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
        await q.query(statement);
      }
      await q.query(`INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
        version,
        Date.now(),
      ]);
    });
  }
}

const globalForDb = globalThis as unknown as { __luckyDb?: Promise<Driver> };

function driver(): Promise<Driver> {
  if (!globalForDb.__luckyDb) {
    globalForDb.__luckyDb = (async () => {
      const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
      if (!url && isVercel) {
        throw new Error(
          "No database connected. In Vercel open your project → Storage → create a free Neon Postgres database and connect it (this adds DATABASE_URL), then redeploy.",
        );
      }
      const d = url ? await createPgDriver(url) : await createPgliteDriver();
      await migrate(d);
      return d;
    })().catch((err) => {
      globalForDb.__luckyDb = undefined;
      throw err;
    });
  }
  return globalForDb.__luckyDb;
}

export async function query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await driver()).query<T>(sql, params);
}

export async function queryOne<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  return (await driver()).tx(fn);
}

export function num(value: unknown): number {
  return value == null ? 0 : Number(value);
}

export function bytes(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string" && value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  throw new Error("Unexpected binary value");
}
