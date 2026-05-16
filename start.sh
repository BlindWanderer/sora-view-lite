#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5173}"
if [ "$HOST" = "127.0.0.1" ] && [ -f config.json ]; then
  HOST="$(node -e "const fs=require('fs');try{const c=JSON.parse(fs.readFileSync('config.json','utf8'));process.stdout.write(c.serverAccessMode==='lan'?'0.0.0.0':'127.0.0.1')}catch{process.stdout.write('127.0.0.1')}")"
fi
URL="http://localhost:${PORT}"

printf '\n================================\n'
printf '       Sora View Lite\n'
printf '       Production Mode\n'
printf '================================\n\n'

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js was not found."
  echo "Please install Node.js 20.19+ or 22.12+ from https://nodejs.org and try again."
  exit 1
fi

if ! node -e "const [maj,min]=process.versions.node.split('.').map(Number); process.exit((maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19)) ? 0 : 1)"; then
  echo "ERROR: Sora View Lite requires Node.js 20.19+ or 22.12+."
  echo "Current Node.js version: $(node --version)"
  exit 1
fi

echo "Node: $(node --version)"
echo

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm was not found. Please reinstall Node.js with npm included."
  exit 1
fi

echo "Checking dependencies..."
npm install --no-audit --no-fund

echo
echo "Building production app..."
npm run build

echo
echo "Starting Sora View Lite at ${URL}"
echo "Bind host: ${HOST}"
echo "Leave this terminal open while using the app."
echo "Press Ctrl+C to stop the server."
echo

# Open browser shortly after server starts, when a Linux opener is available.
(
  sleep 2
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${URL}" >/dev/null 2>&1 || true
  elif command -v gio >/dev/null 2>&1; then
    gio open "${URL}" >/dev/null 2>&1 || true
  fi
) &

export NODE_ENV=production
export HOST
export PORT
export ORIGIN="${URL}"
# Disable adapter-node's 512 KB body-size cap. The app is local-first
# and uploads JSON metadata dumps (Data & Database tab) that routinely
# run into the megabytes.
export BODY_SIZE_LIMIT="Infinity"
npm run start
