// Passwordless magic-link auth + session handling.
import crypto from 'node:crypto'
import { one, query } from './db.js'
import { ulid } from 'ulid'
import { config } from './config.js'

const TOKEN_TTL_MIN = 30

export function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase()
}

// Find an existing learner by email, or create one.
export async function findOrCreateLearner(email, fullName) {
  const e = normaliseEmail(email)
  const isAdmin = config.adminEmails.includes(e)
  const existing = await one('select * from learners where email = $1', [e])
  if (existing) {
    // Keep the name fresh, and keep admin status in sync with the allowlist.
    const newName = fullName && fullName.trim() ? fullName.trim() : existing.full_name
    if (newName !== existing.full_name || isAdmin !== existing.is_admin) {
      await query('update learners set full_name = $1, is_admin = $2 where id = $3',
        [newName, isAdmin, existing.id])
      existing.full_name = newName
      existing.is_admin = isAdmin
    }
    return existing
  }
  const id = ulid()
  await query(
    'insert into learners (id, email, full_name, is_admin) values ($1, $2, $3, $4)',
    [id, e, (fullName || '').trim() || e, isAdmin]
  )
  return one('select * from learners where id = $1', [id])
}

// Create a single-use, short-lived login token for a learner.
export async function createLoginToken(learnerId) {
  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000)
  await query(
    'insert into login_tokens (token, learner_id, expires_at) values ($1, $2, $3)',
    [token, learnerId, expires.toISOString()]
  )
  return token
}

// Check a token WITHOUT consuming it: returns the learner if valid, else null.
// Used to render the confirm-sign-in page on GET so that email link-scanners
// (which only issue GETs) can't burn the single-use token before the human clicks.
export async function verifyLoginToken(token) {
  const row = await one('select * from login_tokens where token = $1', [token])
  if (!row) return null
  if (row.used_at) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null
  return one('select * from learners where id = $1', [row.learner_id])
}

// Consume a token: returns the learner if valid, else null.
export async function consumeLoginToken(token) {
  const row = await one('select * from login_tokens where token = $1', [token])
  if (!row) return null
  if (row.used_at) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null
  await query('update login_tokens set used_at = now() where token = $1', [token])
  await query('update learners set email_verified = true where id = $1', [row.learner_id])
  return one('select * from learners where id = $1', [row.learner_id])
}

// Express middleware: load the logged-in learner onto req/res.locals.
export function attachLearner() {
  return async (req, res, next) => {
    res.locals.learner = null
    const id = req.session?.learnerId
    if (id) {
      const learner = await one('select * from learners where id = $1', [id])
      if (learner) {
        req.learner = learner
        res.locals.learner = learner
      } else {
        req.session.learnerId = null
      }
    }
    next()
  }
}

export function requireAuth(req, res, next) {
  if (!req.learner) {
    const back = encodeURIComponent(req.originalUrl)
    return res.redirect(`/login?next=${back}`)
  }
  next()
}

export function requireAdmin(req, res, next) {
  if (!req.learner) return res.redirect('/login')
  if (!req.learner.is_admin) return res.status(403).render('error', { message: 'Admins only.' })
  next()
}
