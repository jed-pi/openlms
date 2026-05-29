// Learner dashboard: courses grouped by category, with status + certificates.
import express from 'express'
import { all } from '../lib/db.js'
import { requireAuth } from '../lib/auth.js'
import { statusLabel } from '../lib/pass-rules.js'

export const dashboardRouter = express.Router()

dashboardRouter.get('/', requireAuth, async (req, res) => {
  const courses = await all('select * from courses order by sort_order, title')
  const completions = await all(
    'select * from completions where learner_id = $1', [req.learner.id]
  )
  const certs = await all(
    `select c.*, co.title as course_title, co.slug as course_slug
       from certificates c join courses co on co.id = c.course_id
      where c.learner_id = $1 and c.revoked = false
      order by c.issued_at desc`,
    [req.learner.id]
  )

  const byCourse = new Map(completions.map((c) => [c.course_id, c]))
  const certByCourse = new Map(certs.map((c) => [c.course_id, c]))

  // Group courses by category, preserving sort order.
  const groups = []
  const groupIndex = new Map()
  for (const course of courses) {
    if (!groupIndex.has(course.category)) {
      groupIndex.set(course.category, groups.length)
      groups.push({ category: course.category, courses: [] })
    }
    const completion = byCourse.get(course.id) || null
    groups[groupIndex.get(course.category)].courses.push({
      ...course,
      status: statusLabel(completion),
      cert: certByCourse.get(course.id) || null,
    })
  }

  const passedCount = completions.filter((c) => c.passed).length
  res.render('dashboard', { groups, certs, passedCount, total: courses.length })
})
