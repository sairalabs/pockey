#!/usr/bin/env bash
# Local smoke test against `wrangler dev` and the local D1:
#   health, public config, origin check, email OTP login (code read from the
#   console mailer log), /v1/me, and a signature from the embedded EVM wallet.
# Stops only the server it started.
set -u
cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
BASE="http://localhost:$PORT"
APP="pk_app_seed00000000000000000001"
EMBED="http://localhost:5174"
LOG="$(mktemp)"
EMAIL="smoke-$(date +%s)@pockey.local"
DEVICE="smokedevice$(date +%s)abcdef"

if ss -ltn | grep -q ":$PORT "; then
  echo "Port $PORT is busy. Run with PORT=<free port>." >&2
  exit 1
fi

pnpm wrangler dev --port "$PORT" >"$LOG" 2>&1 &
WRANGLER_PID=$!
cleanup() {
  kill "$WRANGLER_PID" 2>/dev/null
  pkill -P "$WRANGLER_PID" 2>/dev/null
  wait "$WRANGLER_PID" 2>/dev/null
  rm -f "$LOG"
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  sleep 1
  curl -s -o /dev/null "$BASE/health" && break
  kill -0 "$WRANGLER_PID" 2>/dev/null || { cat "$LOG"; exit 1; }
done

H_APP="X-Pockey-App-Id: $APP"
H_JSON="Content-Type: application/json"
H_ORIGIN="Origin: $EMBED"
H_DEVICE="X-Pockey-Device: $DEVICE"

echo "== health";          curl -s "$BASE/health"; echo
echo "== config";          curl -s -H "$H_APP" -H "$H_ORIGIN" "$BASE/v1/apps/$APP/config"; echo
echo "== bad origin";      curl -s -o /dev/null -w "%{http_code}\n" -H "$H_APP" -H "Origin: https://evil.example" "$BASE/v1/apps/$APP/config"

echo "== send OTP to $EMAIL"
curl -s -H "$H_APP" -H "$H_JSON" -H "$H_ORIGIN" -H "$H_DEVICE" \
  -d "{\"email\":\"$EMAIL\",\"type\":\"sign-in\"}" "$BASE/v1/auth/email-otp/send-verification-otp"; echo

CODE=""
for _ in $(seq 1 10); do
  CODE="$(grep -oE '[0-9]{6} is your' "$LOG" | tail -n 1 | cut -d' ' -f1)"
  [ -n "$CODE" ] && break
  sleep 1
done
echo "code from console mailer: ${CODE:-none}"

LOGIN="$(curl -s -H "$H_APP" -H "$H_JSON" -H "$H_ORIGIN" -H "$H_DEVICE" \
  -d "{\"email\":\"$EMAIL\",\"otp\":\"$CODE\"}" "$BASE/v1/auth/sign-in/email-otp")"
TOKEN="$(printf '%s' "$LOGIN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).accessToken??"")}catch{console.log("")}})')"
WALLET="$(printf '%s' "$LOGIN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const w=JSON.parse(s).user.wallets.find(x=>x.chainFamily==="evm");console.log(w?w.id+" "+w.address:"")}catch{console.log("")}})')"
echo "== login: token ${TOKEN:0:16}... evm wallet: ${WALLET:-none}"

echo "== me"
curl -s -H "$H_APP" -H "$H_ORIGIN" -H "Authorization: Bearer $TOKEN" "$BASE/v1/me" | head -c 400; echo

WALLET_ID="${WALLET%% *}"
echo "== sign message with $WALLET_ID"
curl -s -H "$H_APP" -H "$H_JSON" -H "$H_ORIGIN" -H "Authorization: Bearer $TOKEN" \
  -d '{"chain":"evm","message":"gm from smoke"}' "$BASE/v1/wallets/$WALLET_ID/sign-message"; echo

echo "== last log lines"
grep -E "\[wrangler:info\]" "$LOG" | tail -n 8
