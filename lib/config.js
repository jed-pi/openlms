import 'dotenv/config'

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())

export const config = {
  siteUrl: (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  port: parseInt(process.env.PORT || '3000', 10),
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
  isProd: process.env.NODE_ENV === 'production',

  databaseUrl: process.env.DATABASE_URL || '',
  // TLS for the DB connection. Default on (Supabase needs it). Set DATABASE_SSL=false
  // for an internal/un-TLS Postgres (e.g. a Coolify-managed database on the same host).
  databaseSsl: process.env.DATABASE_SSL === undefined ? true : bool(process.env.DATABASE_SSL),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  mailFrom: process.env.MAIL_FROM || 'Woodhouse Park Training <no-reply@localhost>',

  // Emails (comma-separated) that should automatically be admins on sign-in.
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  orgName: process.env.ORG_NAME || 'Woodhouse Park Activity Centre',
  brand: {
    green: '#10B85F',
    blue: '#46B4E9',
  },
}

// True when real SMTP is configured; otherwise emails are printed to the console.
export const emailEnabled = Boolean(config.smtp.host)
