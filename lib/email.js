// Email delivery via the charity's SMTP. When SMTP is not configured (local
// dev), emails are printed to the console instead of sent.
import nodemailer from 'nodemailer'
import { config, emailEnabled } from './config.js'

let transporter = null

function getTransporter() {
  if (transporter) return transporter
  if (emailEnabled) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  }
  return transporter
}

export async function sendMail({ to, subject, html, text, attachments }) {
  if (!emailEnabled) {
    console.log('\n──────── EMAIL (SMTP not configured — printing instead) ────────')
    console.log(`To:      ${to}`)
    console.log(`Subject: ${subject}`)
    if (text) console.log(`\n${text}`)
    else if (html) console.log(`\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`)
    if (attachments?.length) console.log(`Attachments: ${attachments.map(a => a.filename).join(', ')}`)
    console.log('────────────────────────────────────────────────────────────────\n')
    return { mocked: true }
  }
  const info = await getTransporter().sendMail({
    from: config.mailFrom,
    to, subject, html, text, attachments,
  })
  return info
}

// Verify SMTP credentials (used by a startup check / admin diagnostics).
export async function verifySmtp() {
  if (!emailEnabled) return { ok: false, reason: 'SMTP not configured' }
  try {
    await getTransporter().verify()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}
