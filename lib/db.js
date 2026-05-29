// Thin database layer. Speaks plain Postgres SQL.
//
//  - Production: set DATABASE_URL to your Supabase Postgres connection string;
//    we connect with node-postgres (pg).
//  - Local dev: leave DATABASE_URL empty and we use PGlite — a full Postgres
//    compiled to WASM that runs in-process and persists to disk. No Docker,
//    no install. Same SQL dialect as Supabase, so nothing changes in prod.
//
// Notes:
//  * PGlite's data dir defaults to a no-space path under the user's home
//    (PGlite mishandles spaces in its WASM filesystem paths, and this project
//    folder contains a space). Override with PGLITE_DIR.
//  * PGlite is a single embedded instance; we serialise queries through a
//    promise chain so concurrent HTTP requests can't race the WASM engine.

import os from 'node:os'
import path from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'

let backend = null

// Serialise async work onto a single chain (used for the PGlite backend).
let chain = Promise.resolve()
function serialise(fn) {
  const run = chain.then(fn, fn)
  chain = run.then(() => {}, () => {})
  return run
}

function pgliteDir() {
  if (process.env.PGLITE_DIR) return process.env.PGLITE_DIR
  return path.join(os.homedir(), '.whp-training', 'pgdata')
}

export async function getDb() {
  if (backend) return backend

  if (config.databaseUrl) {
    const pg = (await import('pg')).default
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
      max: 5,
    })
    backend = {
      kind: 'pg',
      query: (text, params) => pool.query(text, params),
      exec: (sql) => pool.query(sql),
      close: () => pool.end(),
    }
  } else {
    const { PGlite } = await import('@electric-sql/pglite')
    const dir = pgliteDir()
    await mkdir(dir, { recursive: true }) // PGlite won't create parent dirs
    const pglite = new PGlite(dir)
    await pglite.waitReady
    backend = {
      kind: 'pglite',
      dir,
      query: (text, params) => serialise(() => pglite.query(text, params)),
      exec: (sql) => serialise(() => pglite.exec(sql)),
      close: () => serialise(() => pglite.close()),
    }
  }
  return backend
}

export async function query(text, params) {
  const db = await getDb()
  return db.query(text, params)
}

export async function all(text, params) {
  return (await query(text, params)).rows
}
export async function one(text, params) {
  return (await query(text, params)).rows[0] || null
}

export async function applySchema() {
  const db = await getDb()
  const sql = await readFile(fileURLToPath(new URL('../sql/schema.sql', import.meta.url)), 'utf8')
  await db.exec(sql)
}

export async function closeDb() {
  if (backend?.close) await backend.close()
  backend = null
}
