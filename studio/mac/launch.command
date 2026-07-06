#!/bin/bash
# Career-Ops Studio — double-click launcher (macOS).
# Starts the local server (if not already up) and opens it in your browser.
# This is the "app" — no Electron, no build, just your local Studio.

cd "$(dirname "$0")/.." || exit 1        # → studio/
ROOT="$(cd .. && pwd)"                    # career-ops checkout
PORT="${PORT:-4949}"

# already running?
if curl -s "http://localhost:$PORT/api/status" >/dev/null 2>&1; then
  echo "Studio already running → http://localhost:$PORT"
else
  echo "Starting Career-Ops Studio…"
  # find node
  NODE="$(command -v node || echo /usr/local/bin/node)"
  [ -x "$NODE" ] || NODE=/opt/homebrew/bin/node
  nohup "$NODE" server.mjs > /tmp/career-ops-studio.log 2>&1 &
  # wait for it
  for _ in $(seq 1 20); do
    curl -s "http://localhost:$PORT/api/status" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

open "http://localhost:$PORT"
echo "Opened http://localhost:$PORT — logs at /tmp/career-ops-studio.log"
