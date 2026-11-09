import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client, type PoolClient, Pool } from "pg";

/**
 * Testdatabase: vanlig PostgreSQL med en minimal Supabase-stub
 * (supabase/tests/supabase-stub.sql) + prosjektets migrasjoner.
 * Settes opp via DATABASE_URL_TEST, f.eks.
 *   postgres://tester:tester@localhost:5432/myhr_test
 */
export const DB_URL = process.env.DATABASE_URL_TEST;

const root = path.resolve(__dirname, "../..");

export async function resetDatabase() {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    await c.query(`
      drop schema if exists public cascade;
      create schema public;
      drop schema if exists storage cascade;
      drop schema if exists auth cascade;
    `);
    await c.query(readFileSync(path.join(root, "supabase/tests/supabase-stub.sql"), "utf8"));
    const dir = path.join(root, "supabase/migrations");
    for (const f of readdirSync(dir).sort()) await c.query(readFileSync(path.join(dir, f), "utf8"));
  } finally {
    await c.end();
  }
}

export const pool = () => new Pool({ connectionString: DB_URL, max: 4 });

export type Role = { kind: "anon" } | { kind: "authenticated"; sub: string } | { kind: "service" } | { kind: "superuser" };

/** Kjører spørringer som en gitt Supabase-rolle (inkl. JWT-claims for auth.uid()). */
export async function as<T>(p: Pool, role: Role, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await p.connect();
  try {
    await c.query("begin");
    if (role.kind === "anon") {
      await c.query("set local role anon");
      await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    } else if (role.kind === "authenticated") {
      await c.query("set local role authenticated");
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: role.sub, role: "authenticated" })]);
    } else if (role.kind === "service") {
      await c.query("set local role service_role");
      await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    }
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export async function createUser(p: Pool, email: string, owner: boolean): Promise<string> {
  return as(p, { kind: "superuser" }, async (c) => {
    const { rows } = await c.query("insert into auth.users (email) values ($1) returning id", [email]);
    const id = rows[0].id as string;
    if (owner) await c.query("insert into public.users (id, email) values ($1, $2)", [id, email]);
    return id;
  });
}
