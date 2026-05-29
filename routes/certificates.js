// Certificate download + resend.
import express from 'express'
import { one } from '../lib/db.js'
import { requireAuth } from '../lib/auth.js'
import { getCertificatePdf } from '../lib/certificate.js'
import { sendCertificateEmail } from '../lib/notify.js'

export const certificatesRouter = express.Router()

async function loadCertForUser(req) {
  const cert = await one('select * from certificates where id = $1', [req.params.id])
  if (!cert) return { error: 'notfound' }
  const isOwner = req.learner && cert.learner_id === req.learner.id
  const isAdmin = req.learner && req.learner.is_admin
  if (!isOwner && !isAdmin) return { error: 'forbidden' }
  const learner = await one('select * from learners where id = $1', [cert.learner_id])
  const course = await one('select * from courses where id = $1', [cert.course_id])
  return { cert, learner, course }
}

certificatesRouter.get('/:id/download', requireAuth, async (req, res) => {
  const { cert, learner, course, error } = await loadCertForUser(req)
  if (error === 'notfound') return res.status(404).render('error', { message: 'Certificate not found.' })
  if (error === 'forbidden') return res.status(403).render('error', { message: 'Not your certificate.' })
  if (cert.revoked) return res.status(410).render('error', { message: 'This certificate has been revoked.' })

  const pdf = await getCertificatePdf(cert, learner, course)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="certificate-${course.slug}.pdf"`)
  res.send(pdf)
})

certificatesRouter.post('/:id/resend', requireAuth, async (req, res) => {
  const { cert, learner, course, error } = await loadCertForUser(req)
  if (error) return res.status(error === 'notfound' ? 404 : 403).render('error', { message: 'Unable to resend.' })
  if (cert.revoked) return res.status(410).render('error', { message: 'This certificate has been revoked.' })
  await sendCertificateEmail(learner, course, cert)
  res.redirect(req.get('referer') || '/dashboard')
})
