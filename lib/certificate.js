// Branded PDF certificate generation (pure JS via pdf-lib) + issuance.
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'
import { ulid } from 'ulid'
import { one, query } from './db.js'
import { config } from './config.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const certsDir = path.join(root, 'data', 'certificates')
const logoPath = path.join(root, 'assets', 'logo.png')

function hex(h) {
  const n = h.replace('#', '')
  return rgb(parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255)
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function certIdFor(course) {
  const abbr = (course.slug || 'course').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'CERT'
  return `WHP-${abbr}-${ulid()}`
}

// Render the certificate PDF and return a Buffer.
export async function renderCertificatePdf({ id, learnerName, courseTitle, completedAt, issuedAt }) {
  const green = hex(config.brand.green)
  const blue = hex(config.brand.blue)
  const ink = rgb(0.18, 0.18, 0.2)
  const muted = rgb(0.42, 0.42, 0.46)

  const doc = await PDFDocument.create()
  const page = doc.addPage([841.89, 595.28]) // A4 landscape
  const { width, height } = page.getSize()
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const helvObl = await doc.embedFont(StandardFonts.HelveticaOblique)

  const center = (text, font, size, y, color) => {
    const w = font.widthOfTextAtSize(text, size)
    page.drawText(text, { x: (width - w) / 2, y, size, font, color })
  }

  // Outer + inner border.
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: green, borderWidth: 3 })
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderColor: blue, borderWidth: 1 })

  // Logo (3104x618 ~ 5.02:1), centered near the top.
  try {
    const logo = await doc.embedPng(await readFile(logoPath))
    const lw = 250
    const lh = lw * (logo.height / logo.width)
    page.drawImage(logo, { x: (width - lw) / 2, y: height - 70 - lh, width: lw, height: lh })
  } catch { /* logo optional */ }

  center('CERTIFICATE OF COMPLETION', helvBold, 26, height - 200, green)
  center('This certifies that', helv, 13, height - 235, muted)
  center(learnerName, helvBold, 34, height - 285, ink)

  // underline under the name
  const nameW = helvBold.widthOfTextAtSize(learnerName, 34)
  page.drawLine({
    start: { x: (width - Math.max(nameW, 240)) / 2 - 20, y: height - 298 },
    end: { x: (width + Math.max(nameW, 240)) / 2 + 20, y: height - 298 },
    thickness: 1, color: blue,
  })

  center('has successfully completed the training course', helv, 13, height - 330, muted)
  center(courseTitle, helvBold, 22, height - 372, blue)
  center(`Completed on ${formatDate(completedAt)}`, helv, 13, height - 408, ink)
  center(config.orgName, helv, 12, 90, muted)

  // QR + certificate id (bottom-left), for verification.
  const verifyUrl = `${config.siteUrl}/verify/${id}`
  try {
    const qrPng = await QRCode.toBuffer(verifyUrl, { type: 'png', margin: 1, width: 220 })
    const qr = await doc.embedPng(qrPng)
    page.drawImage(qr, { x: 60, y: 60, width: 70, height: 70 })
  } catch { /* qr optional */ }
  page.drawText('Verify this certificate at', { x: 140, y: 110, size: 8, font: helv, color: muted })
  page.drawText(verifyUrl, { x: 140, y: 98, size: 8, font: helvObl, color: blue })
  page.drawText(`Certificate ID: ${id}`, { x: 140, y: 80, size: 8, font: helvBold, color: ink })
  page.drawText(`Issued: ${formatDate(issuedAt)}`, { x: 140, y: 68, size: 8, font: helv, color: muted })

  return Buffer.from(await doc.save())
}

// Issue (or return existing) certificate for a learner+course. Writes the PDF.
export async function issueCertificate(learner, course) {
  const existing = await one(
    'select * from certificates where learner_id = $1 and course_id = $2 and revoked = false',
    [learner.id, course.id]
  )
  if (existing) return existing

  const id = certIdFor(course)
  const completion = await one(
    'select completed_at from completions where learner_id = $1 and course_id = $2',
    [learner.id, course.id]
  )
  const completedAt = completion?.completed_at || new Date()
  const issuedAt = new Date()

  const pdf = await renderCertificatePdf({
    id, learnerName: learner.full_name, courseTitle: course.title, completedAt, issuedAt,
  })
  await mkdir(certsDir, { recursive: true })
  const pdfPath = path.join(certsDir, `${id}.pdf`)
  await writeFile(pdfPath, pdf)

  await query(
    'insert into certificates (id, learner_id, course_id, pdf_path) values ($1, $2, $3, $4)',
    [id, learner.id, course.id, pdfPath]
  )
  return one('select * from certificates where id = $1', [id])
}

// Get the PDF bytes for a certificate, regenerating from the DB record if the
// file is missing (PDFs are deterministic from the record).
export async function getCertificatePdf(cert, learner, course) {
  try {
    if (cert.pdf_path) return await readFile(cert.pdf_path)
  } catch { /* fall through to regenerate */ }
  return renderCertificatePdf({
    id: cert.id,
    learnerName: learner.full_name,
    courseTitle: course.title,
    completedAt: cert.issued_at,
    issuedAt: cert.issued_at,
  })
}

export { certsDir }
