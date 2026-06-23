// Postgres client + idempotent schema for durable, multi-user persistence.
//
// Enabled only when DATABASE_URL is set (production/homelab). Without it the
// app falls back to the file/in-memory stores, so demo + local dev keep working
// with zero infra. This is the swap boundary the research called for; the K8s
// StatefulSet can be replaced by Neon/RDS with just an env-var change.
//
// TLS mirrors the homelab claims app: DATABASE_SSL=verify-full + PGSSLROOTCERT
// pointing at the cert-manager CA, or sslmode in the URL for looser setups.

import { Pool, type PoolClient } from "pg";
import { readFileSync } from "fs";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function isDbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

function sslConfig() {
  const mode = process.env.DATABASE_SSL;
  if (mode === "verify-full") {
    const caPath = process.env.PGSSLROOTCERT;
    return {
      rejectUnauthorized: true,
      ...(caPath ? { ca: readFileSync(caPath, "utf8") } : {}),
    };
  }
  if (mode === "require" || process.env.DATABASE_URL?.includes("sslmode=require")) {
    // Encrypt but don't verify the chain (self-signed in-cluster cert).
    return { rejectUnauthorized: false };
  }
  return undefined;
}

export function getPool(): Pool {
  if (!pool) {
    // Strip sslmode from the URL so our explicit `ssl` object is authoritative.
    // node-postgres v8.21 treats `sslmode=require` in the connection string as
    // verify-full against the system CA store, which rejects the in-cluster
    // self-signed Postgres cert even though we supply the correct CA below.
    const connectionString = process.env.DATABASE_URL?.replace(/([?&])sslmode=[^&]*&?/i, "$1").replace(/[?&]$/, "");
    pool = new Pool({
      connectionString,
      ssl: sslConfig(),
      max: Number(process.env.DATABASE_POOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (err) => console.error("Postgres pool error:", err));
  }
  return pool;
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// Idempotent schema — safe to run on every boot / first query. Single key/value
// table for settings (GL mappings, license prices, etc.) plus typed tables for
// payroll and software licenses.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_entries (
  source      TEXT NOT NULL,
  company_id  TEXT NOT NULL,
  month       TEXT NOT NULL,
  amount      NUMERIC(14,2) NOT NULL,
  headcount   INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, company_id, month)
);

CREATE TABLE IF NOT EXISTS software_licenses (
  id            TEXT PRIMARY KEY,
  vendor        TEXT NOT NULL,
  product       TEXT NOT NULL,
  license_type  TEXT NOT NULL,
  seats         INTEGER NOT NULL DEFAULT 0,
  assigned_seats INTEGER NOT NULL DEFAULT 0,
  unit_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
  billing_cycle TEXT NOT NULL,
  monthly_cost  NUMERIC(14,2) NOT NULL DEFAULT 0,
  annual_cost   NUMERIC(14,2) NOT NULL DEFAULT 0,
  renewal_date  TEXT,
  auto_renew    BOOLEAN,
  category      TEXT NOT NULL,
  source        TEXT NOT NULL,
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor, product)
);

CREATE TABLE IF NOT EXISTS contracts (
  id                 TEXT PRIMARY KEY,
  vendor             TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  category           TEXT NOT NULL DEFAULT 'saas',
  start_date         TEXT,
  end_date           TEXT,
  renewal_type       TEXT NOT NULL DEFAULT 'manual',
  auto_renew         BOOLEAN NOT NULL DEFAULT FALSE,
  notice_period_days INTEGER NOT NULL DEFAULT 0,
  monthly_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  annual_cost        NUMERIC(14,2) NOT NULL DEFAULT 0,
  billing_cycle      TEXT NOT NULL DEFAULT 'annual',
  owner              TEXT NOT NULL DEFAULT '',
  notes              TEXT NOT NULL DEFAULT '',
  tags               JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_id            TEXT,
  file_name          TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

/** Ensure the schema exists. Memoized so it runs at most once per process. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = withClient(async (c) => {
      await c.query(SCHEMA_SQL);
    }).catch((err) => {
      schemaReady = null; // allow retry on next call after a transient failure
      throw err;
    });
  }
  return schemaReady;
}
