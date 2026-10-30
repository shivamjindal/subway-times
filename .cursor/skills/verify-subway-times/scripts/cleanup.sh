#!/usr/bin/env bash
# Stop exactly what launch.sh (and drive.mjs) started for one port, and nothing else.
#
#   .cursor/skills/verify-subway-times/scripts/cleanup.sh [--port 3100]
#
# Kills the recorded process groups after checking each PID still runs the command we started
# (guards against PID reuse), archives server logs next to the evidence, then removes the state
# dir. Evidence under $EVIDENCE_ROOT is never touched.
set -uo pipefail

PORT=3100
[[ "${1:-}" == --port ]] && PORT="$2"
STATE_DIR="${VERIFY_STATE_ROOT:-/tmp/verify-subway-times}/$PORT"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/opt/cursor/artifacts/verify-subway-times}"
STATE="$STATE_DIR/state.json"

if [[ ! -f "$STATE" ]]; then
  echo "nothing to clean: no $STATE"; exit 0
fi

pid_of() { node -e "const p=require('$STATE').pids['$1']; process.stdout.write(p===null?'':String(p))"; }

stop_group() {
  local name="$1" pid="$2" expect="$3"
  [[ -z "$pid" ]] && return
  if [[ ! -d /proc/$pid ]]; then echo "$name ($pid) already gone"; return; fi
  if ! tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q -- "$expect"; then
    echo "$name: pid $pid no longer runs '$expect'; leaving it alone"; return
  fi
  kill -TERM -- "-$pid" 2>/dev/null
  for _ in $(seq 1 20); do [[ -d /proc/$pid ]] || break; sleep 0.25; done
  [[ -d /proc/$pid ]] && kill -KILL -- "-$pid" 2>/dev/null
  echo "stopped $name (process group $pid)"
}

stop_group next "$(pid_of next)" "next"
stop_group mock-mta "$(pid_of mockMta)" "mock-mta.mjs"
stop_group webhook "$(pid_of webhook)" "mock-webhook.mjs"
# A drive.mjs that crashed before its finally block leaves its Chrome profile and pid behind.
for f in "$STATE_DIR"/chrome-*/chrome.pid; do
  [[ -f "$f" ]] && stop_group chrome "$(cat "$f")" "chrome-"
done

ARCHIVE="$EVIDENCE_ROOT/server-logs-$PORT-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$ARCHIVE"
cp "$STATE" "$STATE_DIR"/*.log "$STATE_DIR"/webhook.jsonl "$ARCHIVE"/ 2>/dev/null
rm -rf "$STATE_DIR"
echo "logs archived to $ARCHIVE; state removed"

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "WARNING: port $PORT still answers; something else owns it" >&2; exit 1
fi
