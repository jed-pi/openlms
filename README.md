# Woodhouse Park — Training & Certificates

A small, self-hosted system that plays the charity's existing **SCORM training courses**,
records who has completed what, and issues a **branded PDF certificate** (download + email) on
completion. Built to be simple to run and maintain.

- **Courses:** the 17 SCORM 1.2 packages exported from the LMS, played in-browser via
  [`scorm-again`](https://github.com/jcputney/scorm-again) — no content re-authoring.
- **Sign-in:** passwordless magic links by email.
- **Certificates:** one per course, branded, with a unique ID + QR code that resolves to a public
  verification page.
- **Admin:** completions matrix + CSV export, editable pass marks, tool groups, certificate revoke/resend.

---

## How it works

```
Browser ──> Express app (server-rendered EJS)
              ├─ serves the SCORM courses from /content  (same-origin: required for SCORM)
              ├─ scorm-again provides window.API; courses report completion/score
              ├─ /play/:id/commit  records progress, decides pass/fail (server-authoritative)
              ├─ issues + emails the PDF certificate (pdf-lib + your SMTP)
              └─ Postgres database (Supabase in production)
```

**Why one server (not Vercel etc.):** a SCORM course reaches "up" to `window.parent.API` to report
progress, which browsers only allow **same-origin**. So the course files must be served from the same
origin as the app — i.e. by this app — which is why it runs on a small always-on server.

---

## Requirements

- Node.js 20+ (developed on Node 24)
- The `Induction Files/` folder of SCORM `.zip` packages (already present)
- For production: a **Supabase** project (free tier) + your **SMTP** credentials

---

## Local development

No database to install — the app uses an embedded Postgres (PGlite) on disk.

```bash
npm install
cp .env.example .env          # defaults work for local dev
npm run dev                   # starts on http://localhost:3000 (or PORT)
```

On first run the server creates the schema and **seeds the 17 courses** from `Induction Files/`
(unzipping them into `content/`). Sign in at `/login`; with no SMTP configured the magic-link is shown
on screen. To become an admin, put your email in `ADMIN_EMAILS` in `.env` and sign in.

> If your browser intercepts `localhost` (e.g. a service worker from another local app), use
> `http://127.0.0.1:<port>` instead.

Useful scripts:

```bash
npm run migrate    # apply the schema only
npm run seed       # re-seed courses (set FORCE_EXTRACT=1 to re-unzip)
```

---

## Deploy on Coolify (recommended)

The repo (`jed-pi/openlms`) includes a `Dockerfile` and the SCORM course packages, so Coolify can
build a self-contained image that seeds itself on first run.

1. **Create the application** in Coolify from this Git repository. Build pack: **Dockerfile**.
   Set the exposed port to **3000** (the app reads `PORT`; Coolify provides HTTPS via its proxy).
2. **Add a PostgreSQL database** resource in Coolify (one click). Then on the app set:
   - `DATABASE_URL` = the database's connection string
   - `DATABASE_SSL=false`  (internal Postgres on the same host isn't TLS)

   *(Or use Supabase instead: set `DATABASE_URL` to the Supabase URI and leave `DATABASE_SSL` unset.)*
3. **Set the remaining environment variables** (see the table below): `SITE_URL` (your public
   domain), `SESSION_SECRET` (a long random string), `SMTP_*` + `MAIL_FROM`, and `ADMIN_EMAILS`.
4. **Add a persistent volume** mapped to `/app/data` so generated certificate PDFs survive redeploys.
   *(They're also regenerable from the database, so this is recommended but not strictly required.)*
5. **Deploy.** On first start the app creates the schema and seeds the 17 courses automatically.
   Sign in, and the email(s) in `ADMIN_EMAILS` get the admin area.

The schema is created automatically — there is no separate migration step to run.

---

## Alternative: VPS + systemd + Caddy

If not using Coolify, run it directly on a small VPS. Set `DATABASE_URL` (Supabase) and your `SMTP_*`
in `.env`, then:

```bash
npm ci
sudo cp deploy/whp-training.service /etc/systemd/system/   # runs `node server.js`
sudo systemctl enable --now whp-training
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile               # edit the domain → automatic HTTPS
sudo systemctl reload caddy
```

Set `SITE_URL=https://your-domain` so magic-link and certificate-verify URLs are correct.

### Backups

```bash
deploy/backup.sh    # pg_dump (if DATABASE_URL set) + archive of data/certificates
```

Run nightly via cron. The original `Induction Files/` zips are the source of truth for course content —
keep a copy. Supabase also keeps its own managed backups.

---

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `SITE_URL` | Public base URL (used in links). |
| `PORT` | Port to listen on (default 3000). |
| `SESSION_SECRET` | Secret for signing the session cookie. |
| `DATABASE_URL` | Supabase Postgres connection string. Empty = local PGlite. |
| `SMTP_*`, `MAIL_FROM` | Email delivery. Empty host = print to console. |
| `ADMIN_EMAILS` | Comma-separated emails that become admins on sign-in. |
| `ORG_NAME` | Charity name shown in the UI and certificates. |
| `PGLITE_DIR` | (Dev only) where the local DB lives. Defaults to `~/.whp-training/pgdata`. |

---

## Pass rules

Each course stores a pass rule, seeded from its own package:

- **Completion** — passes when the course reports `completed`/`passed` (most courses).
- **Score** — additionally requires the quiz score ≥ the pass mark. Defaulted on for **PPE, COSHH,
  Emergencies & Fire** (the courses that report a score with a 100% requirement).

Two courses (Facilities & Welfare, Health & Safety Information) are set to 100% in the package but
**don't report a score**, so they're sensibly completion-gated. All pass rules are editable in
**Admin → Courses**. Before go-live, play each course through once to confirm it reports as expected.

---

## Data & privacy (UK GDPR)

The system stores learner **names, emails, and training records** for the legitimate purpose of
recording mandatory safety training. Keep records only as long as needed (e.g. while the person
volunteers/works with the charity, plus any retention required for H&S/insurance), then delete the
learner (cascades to their completions and certificates). Access to personal data is limited to admins.
Certificates contain the learner's name and the course. Avoid putting any other personal data into
course content or certificate fields.

---

## Troubleshooting

- **Local DB error after a hard crash / `mdopenfork`:** the embedded dev DB only — reset it with
  `rm -rf ~/.whp-training/pgdata` and restart (the server re-seeds). Production (Supabase) is unaffected.
- **Magic-link email not arriving:** check `SMTP_*`; with no SMTP the link prints to the server log.
- **A course won't load:** confirm it extracted under `content/<id>/index.html`; re-run `npm run seed`.
