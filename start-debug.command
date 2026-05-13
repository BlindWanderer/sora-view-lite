#!/usr/bin/env bash
# macOS launcher for Sora View Lite debug/dev mode.

cd "$(dirname "$0")"
set -euo pipefail

export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

printf '\n================================\n'
printf '       Sora View Lite\n'
printf '       Debug / Dev Mode\n'
printf '================================\n\n'

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Node.js not found" message "Please install Node.js 20.19+ or 22.12+ from https://nodejs.org and try again."'
  exit 1
fi

if ! node -e "const [maj,min]=process.versions.node.split('.').map(Number); process.exit((maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19)) ? 0 : 1)"; then
  echo "ERROR: Sora View Lite requires Node.js 20.19+ or 22.12+."
  echo "Current Node.js version: $(node --version)"
  read -r -p "Press Return to close..."
  exit 1
fi

echo "Checking dependencies..."
npm install --no-audit --no-fund

echo
echo "Starting Sora View Lite in debug/dev mode..."
echo "Open your browser to http://localhost:5173"
echo "Press Ctrl+C to stop."
echo

(sleep 2 && open "http://localhost:5173") &
npm run dev
