#!/usr/bin/env bash
# Runs the API and web app together. Usage: bash scripts/dev.sh local|cloud
#   local  disposable PostgreSQL with the seeded synthetic accounts (password Synthetic-only-2026!)
#   cloud  the Supabase database configured in .env, with password sign-in for real accounts
#   demo   a separate local database holding Sunrise International School for client demonstrations
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-}"
case "$mode" in
  local)
    npm run db:start
    npm run db:migrate
    npm run seed -w backend
    export DATABASE_TARGET=local DEV_AUTH=synthetic-local
    ;;
  demo)
    bash scripts/demo-db.sh
    export LOCAL_DB_NAME=school_demo DATABASE_TARGET=local DEV_AUTH=synthetic-local VITE_APP_MODE=demo
    ;;
  cloud)
    [ -f .env ] || { echo "Missing .env: copy .env.example and set the Supabase DATABASE_URL." >&2; exit 1; }
    export DATABASE_TARGET=supabase AUTH_MODE=password VITE_APP_MODE=cloud
    ;;
  *) echo "Usage: bash scripts/dev.sh local|cloud|demo" >&2; exit 1 ;;
esac
trap 'kill 0' EXIT INT TERM
npm run dev:api &
npm run dev:web &
if [ "$mode" = demo ]; then npm run demo:seed -w backend || echo "Loading the demo school failed; see the message above." >&2; fi
printf '\n%s mode: open http://127.0.0.1:5178 (Ctrl+C stops both servers)\n\n' "$mode"
wait
