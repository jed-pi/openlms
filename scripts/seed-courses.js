// Manual re-seed of the courses table. (The server also auto-seeds on first run.)
import { getDb, closeDb } from '../lib/db.js'
import { seedCourses } from '../lib/seed.js'

await getDb()
await seedCourses({ verbose: true, forceExtract: Boolean(process.env.FORCE_EXTRACT) })
await closeDb()
process.exit(0)
