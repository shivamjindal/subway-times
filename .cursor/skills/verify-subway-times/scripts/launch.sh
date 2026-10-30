#!/usr/bin/env bash
# Start subway-times for verification and block until rockets are actually rendered.
#
#   .cursor/skills/verify-subway-times/scripts/launch.sh [--port 3100] [--prod] [--mock | --rush] [--real-webhook]
#
# Default: `next dev`, live MTA feed (preflighted), local mock Apps Script webhook on port+802.
# --prod: `next build` then `next start` (required for the spaceport close-up; see features/spaceport-closeup.md).
# --mock / --rush: mock MTA feed on port+801 (rush = 120 s headways), for offline machines or repeatable runs.
# --real-webhook: keep FEEDBACK_WEBHOOK_URL from the environment instead of the local mock. Writes to a real Sheet.
# Everything started is recorded in $STATE_DIR/state.json; cleanup.sh kills exactly that.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$SKILL_DIR/../../.." && pwd)"
PORT=3100
MODE=dev
FEED=live
RUSH=""
REAL_WEBHOOK=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --prod) MODE=prod; shift ;;
    --mock) FEED=mock; shift ;;
    --rush) FEED=mock; RUSH=--rush; shift ;;
    --real-webhook) REAL_WEBHOOK=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
MOCK_PORT=$((PORT + 801))
WEBHOOK_PORT=$((PORT + 802))
STATE_DIR="${VERIFY_STATE_ROOT:-/tmp/verify-subway-times}/$PORT"

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if [[ -f "$STATE_DIR/state.json" ]]; then
  echo "state exists at $STATE_DIR/state.json — run cleanup.sh --port $PORT first" >&2; exit 1
fi
for p in "$PORT" "$WEBHOOK_PORT" $([[ $FEED == mock ]] && echo "$MOCK_PORT"); do
  if port_busy "$p"; then echo "port $p is already in use by something we did not start; pick another --port" >&2; exit 1; fi
done

if [[ $FEED == live ]]; then
  code=$(curl -sS -o /dev/null -m 10 -w '%{http_code}' 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace' || true)
  if [[ "$code" != 200 ]]; then
    echo "live MTA feed unreachable (HTTP ${code:-none}); rerun with --mock" >&2; exit 1
  fi
fi

cd "$REPO"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
mkdir -p "$STATE_DIR"
: > "$STATE_DIR/webhook.jsonl"

# Background jobs in a non-interactive shell are not group leaders, so setsid execs in place:
# $! is both the PID and the process-group ID that cleanup.sh kills.
MOCK_PID=null
if [[ $FEED == mock ]]; then
  setsid node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$SKILL_DIR/scripts/mock-mta.mjs" --port "$MOCK_PORT" $RUSH \
    > "$STATE_DIR/mock-mta.log" 2>&1 < /dev/null &
  MOCK_PID=$!
fi

WEBHOOK_PID=null
if [[ -n $REAL_WEBHOOK ]]; then
  WEBHOOK_URL="${FEEDBACK_WEBHOOK_URL:-}"
else
  setsid node "$SKILL_DIR/scripts/mock-webhook.mjs" --port "$WEBHOOK_PORT" --log "$STATE_DIR/webhook.jsonl" \
    > "$STATE_DIR/mock-webhook.log" 2>&1 < /dev/null &
  WEBHOOK_PID=$!
  WEBHOOK_URL="http://127.0.0.1:$WEBHOOK_PORT/exec"
fi

FEED_BASE=""
[[ $FEED == mock ]] && FEED_BASE="http://127.0.0.1:$MOCK_PORT"
# Same env for build and server: /feedback is prerendered, so its online/offline state is fixed at build time.
export MTA_FEED_BASE_URL="$FEED_BASE" FEEDBACK_WEBHOOK_URL="$WEBHOOK_URL" NEXT_TELEMETRY_DISABLED=1

BUILD_ID=null
if [[ $MODE == prod ]]; then
  echo "building (next build → .next/) …"
  if ! ./node_modules/.bin/next build > "$STATE_DIR/build.log" 2>&1; then
    echo "next build failed; see $STATE_DIR/build.log" >&2; tail -30 "$STATE_DIR/build.log" >&2
    [[ $MOCK_PID != null ]] && kill -- "-$MOCK_PID"; [[ $WEBHOOK_PID != null ]] && kill -- "-$WEBHOOK_PID"
    rm -rf "$STATE_DIR"; exit 1
  fi
  BUILD_ID="\"$(cat .next/BUILD_ID)\""
  setsid ./node_modules/.bin/next start -p "$PORT" > "$STATE_DIR/next.log" 2>&1 < /dev/null &
else
  setsid ./node_modules/.bin/next dev -p "$PORT" > "$STATE_DIR/next.log" 2>&1 < /dev/null &
fi
NEXT_PID=$!

cat > "$STATE_DIR/state.json" <<JSON
{
  "repo": "$REPO",
  "port": $PORT,
  "url": "http://localhost:$PORT",
  "mode": "$MODE",
  "buildId": $BUILD_ID,
  "feed": "$FEED",
  "rush": $([[ -n $RUSH ]] && echo true || echo false),
  "mockPort": $([[ $FEED == mock ]] && echo "$MOCK_PORT" || echo null),
  "webhook": "$([[ -n $REAL_WEBHOOK ]] && echo real || echo mock)",
  "webhookPort": $([[ -n $REAL_WEBHOOK ]] && echo null || echo "$WEBHOOK_PORT"),
  "gitSha": "$(git rev-parse HEAD)",
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pids": { "next": $NEXT_PID, "mockMta": $MOCK_PID, "webhook": $WEBHOOK_PID }
}
JSON
echo "started $MODE: next=$NEXT_PID mock-mta=$MOCK_PID webhook=$WEBHOOK_PID · state $STATE_DIR/state.json"

for _ in $(seq 1 60); do
  port_busy "$PORT" && break
  kill -0 "$NEXT_PID" 2>/dev/null || { echo "next exited; see $STATE_DIR/next.log" >&2; tail -20 "$STATE_DIR/next.log" >&2; exit 1; }
  sleep 1
done

# A port answering is not "ready": wait for the map to draw rockets in a real browser.
node "$SKILL_DIR/scripts/drive.mjs" ready --port "$PORT"
