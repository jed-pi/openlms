// Composes and sends the app's two emails: magic-link sign-in and certificate.
import { sendMail } from './email.js'
import { getCertificatePdf } from './certificate.js'
import { query } from './db.js'
import { config } from './config.js'

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export async function sendMagicLink(learner, url) {
  const subject = `Sign in to ${config.orgName} training`
  const html = `
    <p>Hello ${esc(learner.full_name)},</p>
    <p>Click the button below to sign in to your training. This link is valid for 30 minutes
       and can be used once.</p>
    <p><a href="${esc(url)}" style="display:inline-block;background:${config.brand.green};
       color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">
       Sign in</a></p>
    <p>Or paste this into your browser:<br><a href="${esc(url)}">${esc(url)}</a></p>
    <p>If you didn't request this, you can ignore this email.</p>`
  const text = `Hello ${learner.full_name},\n\nSign in to your training (valid 30 minutes, single use):\n${url}\n\nIf you didn't request this, ignore this email.`
  return sendMail({ to: learner.email, subject, html, text })
}

export async function sendCertificateEmail(learner, course, cert) {
  const downloadUrl = `${config.siteUrl}/certificate/${cert.id}/download`
  const verifyUrl = `${config.siteUrl}/verify/${cert.id}`
  const subject = `Your certificate: ${course.title}`
  const html = `
    <p>Well done, ${esc(learner.full_name)}!</p>
    <p>You've successfully completed <strong>${esc(course.title)}</strong>. Your certificate is
       attached, and you can download it any time:</p>
    <p><a href="${esc(downloadUrl)}" style="display:inline-block;background:${config.brand.green};
       color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">
       Download certificate</a></p>
    <p style="color:#666;font-size:13px">Certificate ID: ${esc(cert.id)}<br>
       Verify: <a href="${esc(verifyUrl)}">${esc(verifyUrl)}</a></p>`
  const text = `Well done, ${learner.full_name}!\n\nYou've completed ${course.title}. Your certificate is attached.\nDownload: ${downloadUrl}\nCertificate ID: ${cert.id}\nVerify: ${verifyUrl}`

  const pdf = await getCertificatePdf(cert, learner, course)
  const info = await sendMail({
    to: learner.email, subject, html, text,
    attachments: [{ filename: `certificate-${course.slug}.pdf`, content: pdf, contentType: 'application/pdf' }],
  })
  await query('update certificates set emailed_at = now() where id = $1', [cert.id])
  return info
}
