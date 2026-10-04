#!/usr/bin/env bash
# Prepares the local demo database (school_demo), separate from the development and test databases.
# Usage: bash scripts/demo-db.sh [--reset]   --reset drops it first so the next start loads a fresh demo school.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/local-db.sh >/dev/null
socket="$PWD/.local/postgres/socket"
pg_bin="${PG_BIN:-}"
if [ -z "$pg_bin" ]; then
  for candidate in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -rV); do
    if [ -x "$candidate/pg_ctl" ]; then pg_bin="$candidate"; break; fi
  done
fi
[ -n "$pg_bin" ] || pg_bin="$(pg_config --bindir)"
psql_admin() { "$pg_bin/psql" -h "$socket" -p 55438 -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
if [ "${1:-}" = "--reset" ]; then psql_admin -c 'DROP DATABASE IF EXISTS school_demo WITH (FORCE)'; echo 'Demo database removed.'; fi
if [ -z "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname='school_demo'")" ]; then psql_admin -c 'CREATE DATABASE school_demo'; fi
LOCAL_DB_NAME=school_demo npm run db:migrate >/dev/null
echo 'Demo database ready.'
