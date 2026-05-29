#!/usr/bin/env bash
# Nightly backup. Run from the app directory, e.g. via cron:
#   0 2 * * *  cd /opt/whp-training && deploy/backup.sh >> /var/log/whp-backup.log 2>&1
#
# Backs up:
#   - the database (pg_dump) when DATABASE_URL is set (Supabase also keeps managed backups)
#   - the generated certificate PDFs (regenerable from the DB, but cheap to keep)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Load DATABASE_URL from .env if present.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

if [ -n "${DATABASE_URL:-}" ] && command -v pg_dump >/dev/null 2>&1; then
  echo "Dumping database…"
  pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"
else
  echo "Skipping pg_dump (no DATABASE_URL or pg_dump not installed)."
fi

if [ -d data/certificates ]; then
  echo "Archiving certificates…"
  tar -czf "$BACKUP_DIR/certificates-$STAMP.tar.gz" -C data certificates
fi

# Keep the last 30 days of backups.
find "$BACKUP_DIR" -name '*.gz' -mtime +30 -delete 2>/dev/null || true
echo "Backup complete: $BACKUP_DIR (stamp $STAMP)"
