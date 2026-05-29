// Admin area: overview, course pass-rules, completions matrix + CSV, learners,
// tool groups, certificate revoke. Gated by is_admin.
import express from 'express'
import { all, one, query } from '../lib/db.js'
import { requireAdmin } from '../lib/auth.js'
import { ulid } from 'ulid'

export const adminRouter = express.Router()
adminRouter.use(requireAdmin)

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'group'
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const isoDate = (d) => {
  if (!d) return ''
  try { return new Date(d).toISOString().replace('T', ' ').slice(0, 16) } catch { return '' }
}

// --- Overview ---
adminRouter.get('/', async (req, res) => {
  const courses = await all('select * from courses order by sort_order, title')
  const learners = await all('select * from learners order by created_at desc')
  const stats = await one(`select
    (select count(*) from learners) as learners,
    (select count(*) from courses) as courses,
    (select count(*) from completions where passed) as passes,
    (select count(*) from certificates where not revoked) as certs`)
  res.render('admin/dashboard', { courses, learners, stats })
})

// --- Course pass-rules ---
adminRouter.get('/courses', async (req, res) => {
  const courses = await all('select * from courses order by sort_order, title')
  res.render('admin/courses', { courses, saved: req.query.saved === '1' })
})

adminRouter.post('/courses/:id', async (req, res) => {
  const course = await one('select * from courses where id = $1', [req.params.id])
  if (!course) return res.status(404).render('error', { message: 'Course not found.' })
  const title = (req.body.title || course.title).trim()
  const minimumScore = Math.max(0, Math.min(100, parseInt(req.body.minimum_score, 10) || 0))
  const gateOnScore = req.body.gate_on_score === 'on'
  await query(
    'update courses set title = $1, minimum_score = $2, gate_on_score = $3 where id = $4',
    [title, minimumScore, gateOnScore, course.id]
  )
  res.redirect('/admin/courses?saved=1')
})

// --- Completions matrix ---
adminRouter.get('/completions', async (req, res) => {
  const courses = await all('select id, title, category from courses order by sort_order, title')
  const learners = await all('select id, full_name, email from learners order by full_name')
  const rows = await all('select learner_id, course_id, passed, lesson_status, score_raw from completions')
  const map = new Map(rows.map((r) => [`${r.learner_id}:${r.course_id}`, r]))
  res.render('admin/completions', { courses, learners, map })
})

adminRouter.get('/completions.csv', async (req, res) => {
  const rows = await all(`
    select l.full_name, l.email, co.category, co.title,
           c.lesson_status, c.score_raw, c.passed, c.completed_at
      from completions c
      join learners l on l.id = c.learner_id
      join courses co on co.id = c.course_id
     order by l.full_name, co.sort_order`)
  const header = ['Name', 'Email', 'Category', 'Course', 'Status', 'Score', 'Passed', 'Completed']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([r.full_name, r.email, r.category, r.title, r.lesson_status,
      r.score_raw ?? '', r.passed ? 'yes' : 'no', isoDate(r.completed_at)].map(csvCell).join(','))
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="completions.csv"')
  res.send(lines.join('\n'))
})

// --- Learners ---
adminRouter.get('/learners', async (req, res) => {
  const learners = await all(`
    select l.*, count(c.id) filter (where c.passed) as passed_count
      from learners l left join completions c on c.learner_id = l.id
     group by l.id order by l.full_name`)
  res.render('admin/learners', { learners })
})

adminRouter.get('/learners/:id', async (req, res) => {
  const learner = await one('select * from learners where id = $1', [req.params.id])
  if (!learner) return res.status(404).render('error', { message: 'Learner not found.' })
  const courses = await all('select * from courses order by sort_order, title')
  const completions = await all('select * from completions where learner_id = $1', [learner.id])
  const certs = await all(`select c.*, co.title as course_title from certificates c
    join courses co on co.id = c.course_id where c.learner_id = $1 order by c.issued_at desc`, [learner.id])
  const byCourse = new Map(completions.map((c) => [c.course_id, c]))
  res.render('admin/learner', { learner, courses, byCourse, certs })
})

adminRouter.post('/learners/:id/verify', async (req, res) => {
  await query('update learners set email_verified = true where id = $1', [req.params.id])
  res.redirect(`/admin/learners/${req.params.id}`)
})

// --- Certificate revoke ---
adminRouter.post('/certificates/:id/revoke', async (req, res) => {
  await query('update certificates set revoked = true where id = $1', [req.params.id])
  res.redirect(req.get('referer') || '/admin')
})

// --- Tool groups ---
adminRouter.get('/tools', async (req, res) => {
  const groups = await all('select * from tool_groups order by sort_order, name')
  const courses = await all('select id, title, category from courses order by sort_order, title')
  const links = await all('select * from tool_group_courses')
  const membership = new Map()
  for (const g of groups) membership.set(g.id, new Set())
  for (const l of links) membership.get(l.tool_group_id)?.add(l.course_id)
  res.render('admin/tools', { groups, courses, membership })
})

adminRouter.post('/tools', async (req, res) => {
  const name = (req.body.name || '').trim()
  if (name) {
    await query('insert into tool_groups (id, name, slug) values ($1, $2, $3)',
      [ulid(), name, slugify(name) + '-' + Date.now().toString(36)])
  }
  res.redirect('/admin/tools')
})

adminRouter.post('/tools/:id', async (req, res) => {
  const id = req.params.id
  const courseIds = [].concat(req.body.course_ids || [])
  await query('delete from tool_group_courses where tool_group_id = $1', [id])
  for (const cid of courseIds) {
    await query('insert into tool_group_courses (tool_group_id, course_id) values ($1, $2) on conflict do nothing', [id, cid])
  }
  res.redirect('/admin/tools')
})

adminRouter.post('/tools/:id/delete', async (req, res) => {
  await query('delete from tool_groups where id = $1', [req.params.id])
  res.redirect('/admin/tools')
})
