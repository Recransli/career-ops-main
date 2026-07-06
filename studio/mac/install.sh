#!/bin/bash
# Career-Ops Studio — macOS "always-on" install.
# Installs a launchd LaunchAgent so Studio starts at login, stays running
# (auto-restart), and its in-app daily refresh (set in Settings) can fire at
# noon without you keeping a terminal open. No Electron, no admin rights.
#
#   bash studio/mac/install.sh          # install & start
#   bash studio/mac/install.sh --remove # uninstall
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"     # → studio/
LABEL="com.career-ops.studio"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "$1" = "--remove" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL. Studio will no longer auto-start."
  exit 0
fi

NODE="$(command -v node || true)"
[ -z "$NODE" ] && [ -x /opt/homebrew/bin/node ] && NODE=/opt/homebrew/bin/node
[ -z "$NODE" ] && [ -x /usr/local/bin/node ] && NODE=/usr/local/bin/node
if [ -z "$NODE" ]; then echo "Node not found — install Node 18+ first."; exit 1; fi

mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s#__NODE__#$NODE#g" -e "s#__DIR__#$DIR#g" \
  "$DIR/mac/com.career-ops.studio.plist.template" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed $LABEL (node: $NODE)."
echo "Studio now runs at login and stays alive → http://localhost:4949"
echo "Enable the daily 12:00 refresh in Settings → Daily refresh."
echo "Uninstall: bash studio/mac/install.sh --remove"
