// Passwordless sign-in routes.
import express from 'express'
import { findOrCreateLearner, createLoginToken, consumeLoginToken, verifyLoginToken, normaliseEmail } from '../lib/auth.js'
import { sendMagicLink } from '../lib/notify.js'
import { config, emailEnabled } from '../lib/config.js'

export const authRouter = express.Router()

function safeNext(next) {
  // Only allow local redirects.
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) return next
  return '/dashboard'
}

authRouter.get('/login', (req, res) => {
  if (req.learner) return res.redirect('/dashboard')
  res.render('login', { next: req.query.next || '', error: null, values: {} })
})

authRouter.post('/login', async (req, res) => {
  const email = normaliseEmail(req.body.email)
  const fullName = (req.body.full_name || '').trim()
  const next = safeNext(req.body.next)

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).render('login', {
      next, error: 'Please enter a valid email address.', values: { full_name: fullName, email: req.body.email },
    })
  }
  if (!fullName) {
    return res.status(400).render('login', {
      next, error: 'Please enter your full name.', values: { full_name: fullName, email },
    })
  }

  const learner = await findOrCreateLearner(email, fullName)
  const token = await createLoginToken(learner.id)
  const url = `${config.siteUrl}/auth/${token}${next ? `?next=${encodeURIComponent(next)}` : ''}`
  await sendMagicLink(learner, url)

  res.render('check-email', { email, devLink: emailEnabled ? null : url })
})

// GET only *validates* the token (no consume) and shows a confirm button.
// Email security scanners issue GETs to pre-check links — if GET consumed the
// single-use token, the human's later click would always fail. The actual
// sign-in happens on POST below, which scanners don't perform.
authRouter.get('/auth/:token', async (req, res) => {
  if (req.learner) return res.redirect(safeNext(req.query.next))
  const learner = await verifyLoginToken(req.params.token)
  if (!learner) {
    return res.status(400).render('error', {
      message: 'This sign-in link is invalid or has expired. Please request a new one.',
    })
  }
  res.render('confirm-signin', {
    token: req.params.token,
    next: safeNext(req.query.next),
    learner,
  })
})

authRouter.post('/auth/:token', async (req, res) => {
  const learner = await consumeLoginToken(req.params.token)
  if (!learner) {
    return res.status(400).render('error', {
      message: 'This sign-in link is invalid or has expired. Please request a new one.',
    })
  }
  req.session.learnerId = learner.id
  res.redirect(safeNext(req.body.next))
})

authRouter.post('/logout', (req, res) => {
  req.session = null
  res.redirect('/login')
})
