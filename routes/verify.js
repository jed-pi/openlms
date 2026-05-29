// Public certificate verification page (no login required).
import express from 'express'
import { one } from '../lib/db.js'

export const verifyRouter = express.Router()

verifyRouter.get('/:id', async (req, res) => {
  const cert = await one('select * from certificates where id = $1', [req.params.id])
  let learner = null
  let course = null
  if (cert) {
    learner = await one('select full_name from learners where id = $1', [cert.learner_id])
    course = await one('select title from courses where id = $1', [cert.course_id])
  }
  const valid = Boolean(cert) && !cert.revoked
  res.render('verify', { id: req.params.id, cert, learner, course, valid })
})
