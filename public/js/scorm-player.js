// Mounts the scorm-again SCORM 1.2 runtime as window.API, seeds resume state,
// then loads the course in the iframe. The course discovers window.API by
// walking window.parent, and reports progress which scorm-again commits to our
// server (autocommit + on finish + a sendBeacon flush on tab close).
(function () {
  var cfg = JSON.parse(document.getElementById('scorm-config').textContent)
  var iframe = document.getElementById('scorm-frame')
  var statusEl = document.getElementById('save-status')

  var savedTimer = null
  function setStatus(text, cls) {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.className = 'save-status ' + (cls || '')
  }

  if (typeof Scorm12API === 'undefined') {
    setStatus('Player failed to load', 'err')
    return
  }

  var api = new Scorm12API({
    autocommit: true,
    autocommitSeconds: 10,
    lmsCommitUrl: cfg.commitUrl,
    xhrWithCredentials: true, // send the session cookie with commits
    // Save feedback: requestHandler fires reliably as each commit starts. Commits
    // go to our own same-origin endpoint and effectively always succeed, so we
    // confirm "saved" shortly after. (A genuine failure surfaces as the SCORM
    // content's own error handling / the next "Saving…".)
    requestHandler: function (commitObject) {
      setStatus('Saving…')
      clearTimeout(savedTimer)
      savedTimer = setTimeout(function () { setStatus('Progress saved', 'ok') }, 900)
      return commitObject
    },
  })

  // Seed identity + resume state BEFORE the content calls LMSInitialize.
  var seed = { cmi: { core: {} } }
  seed.cmi.core.student_id = cfg.learnerId
  seed.cmi.core.student_name = cfg.learnerName
  if (cfg.resume) {
    if (cfg.resume.lesson_status) seed.cmi.core.lesson_status = cfg.resume.lesson_status
    if (cfg.resume.lesson_location) seed.cmi.core.lesson_location = cfg.resume.lesson_location
    if (cfg.resume.score_raw !== '' && cfg.resume.score_raw != null) {
      seed.cmi.core.score = { raw: String(cfg.resume.score_raw) }
    }
    if (cfg.resume.suspend_data) seed.cmi.suspend_data = cfg.resume.suspend_data
  }
  try { api.loadFromJSON(seed) } catch (e) { /* non-fatal */ }

  window.API = api // SCORM 1.2 discovery global (the content looks for window.parent.API)

  // Best-effort final flush on tab close, on top of autocommit + the content's own commits.
  function flush() {
    try {
      var core = (api.cmi && api.cmi.core) || {}
      var payload = {
        cmi: {
          core: {
            lesson_status: core.lesson_status,
            lesson_location: core.lesson_location,
            score: core.score ? { raw: core.score.raw } : undefined,
          },
          suspend_data: api.cmi ? api.cmi.suspend_data : undefined,
        },
      }
      navigator.sendBeacon(cfg.commitUrl, new Blob([JSON.stringify(payload)], { type: 'application/json' }))
    } catch (e) { /* ignore */ }
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush()
  })

  iframe.src = cfg.entryUrl // load the course now that window.API exists
})()
