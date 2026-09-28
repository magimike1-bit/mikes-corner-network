#!/usr/bin/env bash
# weekly-backup.sh — logical backup of the FairRate Audit Supabase Postgres.
# NOT scheduled by default; hand to the ops backup routine when ready.
#
# Usage: FRA_SUPABASE_DB_URL="postgresql://postgres:<db-password>@db.<ref>.supabase.co:5432/postgres" \
#          ./weekly-backup.sh [output-dir]
#
# The connection string comes from the ENVIRONMENT, never from this repo.
# Keeps the last 4 dumps (matches the network's 4-week retention rule).
set -euo pipefail
OUT_DIR="${1:-$HOME/workspace/ops/supabase-backups}"
mkdir -p "$OUT_DIR"
if [ -z "${FRA_SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: set FRA_SUPABASE_DB_URL first (see supabase/README.md)." >&2
  exit 1
fi
STAMP="$(date +%F)"
FILE="$OUT_DIR/fairrate-audit-$STAMP.sql.zst"
pg_dump "$FRA_SUPABASE_DB_URL" --no-owner --no-acl \
  | zstd -19 -o "$FILE"
ls -t "$OUT_DIR"/fairrate-audit-*.sql.zst | tail -n +5 | xargs -r rm --
echo "wrote $FILE"
