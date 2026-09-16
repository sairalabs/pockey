#!/usr/bin/env bash
# Starts the API for the playground end to end suite: fresh local migrations,
# seed, then wrangler dev with the console mailer, logging to a file the tests read.
set -eu
cd "$(dirname "$0")/.."
LOG_DIR="../playground/.e2e"
mkdir -p "$LOG_DIR"
: > "$LOG_DIR/api.log"
if [ ! -f .dev.vars ]; then
  printf "BETTER_AUTH_SECRET=%s\nMOCK_KEY_SEED=%s\n" "$(openssl rand -hex 32)" "$(openssl rand -hex 16)" > .dev.vars
fi
pnpm exec wrangler d1 migrations apply pocketkey --local >/dev/null
pnpm exec wrangler d1 execute pocketkey --local --file ../../packages/db/seed/local.sql >/dev/null
exec pnpm exec wrangler dev --port 8787 --var MAILER:console >> "$LOG_DIR/api.log" 2>&1
