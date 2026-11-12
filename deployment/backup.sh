#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${DATABASE_URL:?Set DATABASE_URL securely}"
: "${BACKUP_RECIPIENT:?Set an age public recipient}"
: "${BACKUP_DIR:?Set a protected backup directory}"
command -v pg_dump >/dev/null
command -v age >/dev/null
mkdir -p "$BACKUP_DIR"
backup_file="$BACKUP_DIR/profitendo-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump.age"
partial_file="$backup_file.partial"
trap 'rm -f "$partial_file"' EXIT
# Keep the connection URL out of command arguments and logs.
PGDATABASE="$DATABASE_URL" pg_dump --format=custom --no-owner --no-acl | age -r "$BACKUP_RECIPIENT" > "$partial_file"
mv "$partial_file" "$backup_file"
printf 'Encrypted backup completed: %s\n' "$backup_file"
