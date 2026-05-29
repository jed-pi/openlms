// SCORM course player + the commit endpoint that scorm-again POSTs to.
import express from 'express'
import { one, query } from '../lib/db.js'
import { requireAuth } from '../lib/auth.js'
import { computePassed } from '../lib/pass-rules.js'
import { issueCertificate } from '../lib/certificate.js'
import { sendCertificateEmail } from '../lib/notify.js'
import { ulid } from 'ulid'

export const playerRouter = express.Router()

function parseScore(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const n = parseFloat(raw)
  return Number.isFinite(n) ? Math.round(n) : null
}

// Full-screen player page.
playerRouter.get('/:id', requireAuth, async (req, res) => {
  const course = await one('select * from courses where id = $1', [req.params.id])
  if (!course) return res.status(404).render('error', { message: 'Course not found.' })

  const completion = await one(
    'select * from completions where learner_id = $1 and course_id = $2',
    [req.learner.id, course.id]
  )

  res.render('player', {
    course,
    learner: req.learner,
    entryUrl: `${course.content_path}/${course.entry}`,
    commitUrl: `/play/${course.id}/commit`,
    resume: completion
      ? {
          lesson_status: completion.lesson_status || '',
          lesson_location: completion.lesson_location || '',
          score_raw: completion.score_raw ?? '',
          suspend_data: completion.suspend_data || '',
        }
      : null,
  })
})

// scorm-again commits here (autocommit, on finish, and via sendBeacon on unload).
playerRouter.post('/:id/commit', requireAuth, async (req, res) => {
  const course = await one('select * from courses where id = $1', [req.params.id])
  if (!course) return res.status(404).json({ result: false, errorCode: 101 })

  const cmi = req.body?.cmi || {}
  const core = cmi.core || {}
  const lessonStatus = core.lesson_status || null
  const scoreRaw = parseScore(core.score?.raw)
  const suspendData = cmi.suspend_data ?? null
  const lessonLocation = core.lesson_location ?? null

  const existing = await one(
    'select * from completions where learner_id = $1 and course_id = $2',
    [req.learner.id, course.id]
  )
  const nowPassed = computePassed(course, lessonStatus, scoreRaw)
  const passed = Boolean(existing?.passed) || nowPassed
  const newlyPassed = nowPassed && !existing?.passed
  const completedAt = existing?.completed_at || (nowPassed ? new Date().toISOString() : null)

  await query(
    `insert into completions
       (id, learner_id, course_id, lesson_status, score_raw, suspend_data, lesson_location, raw_cmi, passed, completed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10, now())
     on conflict (learner_id, course_id) do update set
       lesson_status   = excluded.lesson_status,
       score_raw       = excluded.score_raw,
       suspend_data    = excluded.suspend_data,
       lesson_location = excluded.lesson_location,
       raw_cmi         = excluded.raw_cmi,
       passed          = excluded.passed,
       completed_at    = excluded.completed_at,
       updated_at      = now()`,
    [ulid(), req.learner.id, course.id, lessonStatus, scoreRaw, suspendData, lessonLocation,
     JSON.stringify(cmi), passed, completedAt]
  )

  // On first pass, issue the certificate and email it (best-effort).
  if (newlyPassed) {
    try {
      const cert = await issueCertificate(req.learner, course)
      sendCertificateEmail(req.learner, course, cert).catch((e) =>
        console.error('certificate email failed:', e.message))
    } catch (e) {
      console.error('certificate issue failed:', e.message)
    }
  }

  res.json({ result: true, errorCode: 0, passed })
})
