import express from 'express'
import cookieSession from 'cookie-session'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './lib/config.js'
import { applySchema, closeDb, one } from './lib/db.js'
import { seedCourses } from './lib/seed.js'
import { attachLearner } from './lib/auth.js'
import { authRouter } from './routes/auth.js'
import { dashboardRouter } from './routes/dashboard.js'
import { playerRouter } from './routes/player.js'
import { certificatesRouter } from './routes/certificates.js'
import { verifyRouter } from './routes/verify.js'
import { adminRouter } from './routes/admin.js'

const root = fileURLToPath(new URL('.', import.meta.url))

await applySchema() // idempotent — ensure tables exist on startup
// Auto-seed courses on first run (keeps the local DB owned by one process).
const courseCount = await one('select count(*)::int as n from courses')
if (!courseCount || courseCount.n === 0) {
  console.log('No courses found — seeding from SCORM packages…')
  await seedCourses({ verbose: false })
}

const app = express()
app.set('view engine', 'ejs')
app.set('views', path.join(root, 'views'))
app.disable('x-powered-by')

app.use(express.urlencoded({ extended: false }))
app.use(express.json({ limit: '4mb' })) // SCORM commits carry suspend_data + full cmi

app.use('/public', express.static(path.join(root, 'public')))
app.use('/vendor', express.static(path.join(root, 'node_modules', 'scorm-again', 'dist')))
app.use('/content', express.static(path.join(root, 'content'), { fallthrough: false, maxAge: '1h' }))

app.use(cookieSession({
  name: 'whp_sess',
  keys: [config.sessionSecret],
  maxAge: 1000 * 60 * 60 * 24 * 30,
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
}))
app.use(attachLearner())

app.use((req, res, next) => {
  res.locals.orgName = config.orgName
  res.locals.brand = config.brand
  res.locals.currentPath = req.path
  next()
})

app.get('/', (req, res) => res.redirect(req.learner ? '/dashboard' : '/login'))
app.use(authRouter)
app.use('/dashboard', dashboardRouter)
app.use('/play', playerRouter)
app.use('/certificate', certificatesRouter)
app.use('/verify', verifyRouter)
app.use('/admin', adminRouter)

app.use((req, res) => res.status(404).render('error', { message: 'Page not found.' }))
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).render('error', { message: 'Something went wrong.' })
})

const server = app.listen(config.port, () => {
  console.log(`Woodhouse Park Training running at ${config.siteUrl} (port ${config.port})`)
})

// Graceful shutdown so the local PGlite database flushes cleanly on restart.
let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  server.close()
  try { await closeDb() } catch { /* ignore */ }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
