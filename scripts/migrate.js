// Apply the database schema. Works against PGlite (local) or Supabase (DATABASE_URL).
import { applySchema, getDb, closeDb } from '../lib/db.js'

const db = await getDb()
await applySchema()
console.log(`Schema applied (${db.kind}).`)
await closeDb()
process.exit(0)
