#!/usr/bin/env bash
# Local smoke test: boots wrangler dev against the local D1, hits three
# endpoints, prints the bodies, then stops only the server it started.
set -u
cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
LOG="$(mktemp)"

pnpm wrangler dev --port "$PORT" >"$LOG" 2>&1 &
WRANGLER_PID=$!

for _ in $(seq 1 60); do
  sleep 1
  if curl -s -o /dev/null "http://localhost:$PORT/health"; then break; fi
  if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then break; fi
done

APP="pk_app_seed00000000000000000001"
echo "== /health"
curl -s "http://localhost:$PORT/health"; echo
echo "== /v1/apps/$APP/config (allowed origin)"
curl -s -H "X-Pocketkey-App-Id: $APP" -H "Origin: http://localhost:3000" \
  "http://localhost:$PORT/v1/apps/$APP/config"; echo
echo "== /v1/apps/$APP/config (bad origin)"
curl -s -H "X-Pocketkey-App-Id: $APP" -H "Origin: https://evil.example" \
  "http://localhost:$PORT/v1/apps/$APP/config"; echo

kill "$WRANGLER_PID" 2>/dev/null
pkill -P "$WRANGLER_PID" 2>/dev/null
wait "$WRANGLER_PID" 2>/dev/null
echo "== last log lines"
tail -n 4 "$LOG"
rm -f "$LOG"
