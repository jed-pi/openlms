// Server-authoritative pass logic. The course content reports a status/score,
// but the SERVER decides whether the course counts as passed, using the rule
// stored on the course (seeded from the package's own config.json).

// A course is PASSED when the learner has finished it (lesson_status passed or
// completed) AND, where the course is score-gated, their score meets the minimum.
export function computePassed(course, lessonStatus, scoreRaw) {
  const status = String(lessonStatus || '').toLowerCase()
  const finished = status === 'passed' || status === 'completed'
  if (!finished) return false

  if (course.gate_on_score) {
    if (scoreRaw === null || scoreRaw === undefined || scoreRaw === '') return false
    return Number(scoreRaw) >= Number(course.minimum_score)
  }
  return true
}

// Map a SCORM 1.2 lesson_status to a friendly badge for the dashboard.
export function statusLabel(completion) {
  if (!completion) return { key: 'not-started', label: 'Not started' }
  if (completion.passed) return { key: 'passed', label: 'Passed' }
  const s = String(completion.lesson_status || '').toLowerCase()
  if (s === 'failed') return { key: 'failed', label: 'Not yet passed' }
  if (s === 'completed' || s === 'passed') return { key: 'review', label: 'Awaiting review' }
  return { key: 'in-progress', label: 'In progress' }
}
