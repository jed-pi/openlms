// Seed the `courses` table from the exported SCORM packages.
// Reusable so the server can auto-seed on startup (keeping the local PGlite
// database owned by a single process), and scripts/seed-courses.js can call it.
import AdmZip from 'adm-zip'
import { readdir, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { query } from './db.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sourceDir = path.join(root, 'Induction Files')
const contentDir = path.join(root, 'content')

const CATEGORY_ORDER = [
  'Induction',
  'Handling Power Tools',
  'Ladder Safety',
  'Asbestos Awareness',
  'Working with Display Screen Equipment',
]

async function findZips(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await findZips(full)))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) out.push(full)
  }
  return out
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'course'
}

function readConfig(zip) {
  const entry = zip.getEntry('config.json')
  if (!entry) throw new Error('no config.json in package')
  return JSON.parse(zip.readAsText(entry))
}

export async function seedCourses({ verbose = false, forceExtract = false } = {}) {
  const sourceExists = await stat(sourceDir).then(() => true).catch(() => false)
  if (!sourceExists) throw new Error(`Source folder not found: ${sourceDir}`)

  const zips = await findZips(sourceDir)
  if (verbose) console.log(`Found ${zips.length} SCORM package(s).\n`)

  const usedSlugs = new Set()
  const rows = []

  for (const zipPath of zips) {
    const category = path.basename(path.dirname(zipPath))
    const zip = new AdmZip(zipPath)
    let cfg
    try {
      cfg = readConfig(zip)
    } catch (e) {
      if (verbose) console.warn(`  ! skipping ${path.basename(zipPath)}: ${e.message}`)
      continue
    }

    const id = String(cfg.id || '').trim()
    const title = String(cfg.title || path.basename(zipPath)).trim()
    if (!id) {
      if (verbose) console.warn(`  ! skipping ${path.basename(zipPath)}: no id`)
      continue
    }

    const inner = cfg.config || {}
    const minimumScore = Number(inner.minimumScore ?? cfg.minimumScore ?? 0) || 0
    const disableLessonScore = Boolean(inner.disableLessonScore ?? cfg.disableLessonScore ?? false)
    const gateOnScore = minimumScore > 0 && !disableLessonScore

    let slug = slugify(title)
    if (usedSlugs.has(slug)) slug = `${slug}-${id.slice(-6)}`
    usedSlugs.add(slug)

    const dest = path.join(contentDir, id)
    const already = await stat(path.join(dest, 'index.html')).then(() => true).catch(() => false)
    if (!already || forceExtract) {
      await rm(dest, { recursive: true, force: true })
      await mkdir(dest, { recursive: true })
      zip.extractAllTo(dest, true)
    }

    rows.push({
      id, slug, title, category,
      content_path: `/content/${id}`,
      minimum_score: minimumScore,
      disable_lesson_score: disableLessonScore,
      gate_on_score: gateOnScore,
    })
  }

  rows.sort((a, b) => {
    const oa = CATEGORY_ORDER.indexOf(a.category) === -1 ? 999 : CATEGORY_ORDER.indexOf(a.category)
    const ob = CATEGORY_ORDER.indexOf(b.category) === -1 ? 999 : CATEGORY_ORDER.indexOf(b.category)
    if (oa !== ob) return oa - ob
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.title.localeCompare(b.title)
  })
  rows.forEach((r, i) => (r.sort_order = i))

  for (const r of rows) {
    await query(
      `insert into courses
         (id, slug, title, category, content_path, entry, minimum_score, disable_lesson_score, gate_on_score, sort_order)
       values ($1,$2,$3,$4,$5,'index.html',$6,$7,$8,$9)
       on conflict (id) do update set
         category = excluded.category, content_path = excluded.content_path,
         disable_lesson_score = excluded.disable_lesson_score, sort_order = excluded.sort_order`,
    // Note: title, slug, minimum_score and gate_on_score are intentionally NOT
    // overwritten on re-seed, so admin edits are preserved.
      [r.id, r.slug, r.title, r.category, r.content_path,
       r.minimum_score, r.disable_lesson_score, r.gate_on_score, r.sort_order]
    )
  }

  if (verbose) {
    const pad = (s, n) => String(s).padEnd(n)
    for (const r of rows) {
      console.log(pad(r.category, 38), pad(r.title.replace(/\s+/g, ' '), 26),
        pad(r.minimum_score, 9), pad(r.disable_lesson_score ? 'no-score' : '', 9),
        r.gate_on_score ? 'SCORE' : 'complete')
    }
    console.log(`\nSeeded ${rows.length} course(s). Score-gated: ${rows.filter(r => r.gate_on_score).map(r => r.title).join(', ')}`)
  }
  return rows
}
