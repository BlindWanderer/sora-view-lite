#!/usr/bin/env bash
# macOS one-click installer for Playwright + Chromium.
# Double-click this file. If macOS asks about permissions, allow it in
# System Settings > Privacy & Security.

cd "$(dirname "$0")"
set -euo pipefail

export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

printf '\n================================\n'
printf '  Sora View Lite\n'
printf '  Install Playwright + Chromium\n'
printf '================================\n\n'
printf 'This installs the Playwright package and the Chromium browser binary\n'
printf 'that the Refresh Sora Assets pipeline needs for step 3 (Fetch HTML).\n\n'
printf 'You only need to do this once. The download is roughly 250 MB.\n\n'

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

echo "Node: $(node --version)"
echo

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "npm not found" message "Please reinstall Node.js with npm included."'
  exit 1
fi

echo "Step 1 of 2: Installing the Playwright package..."
echo
if ! npm install playwright --no-audit --no-fund; then
  echo
  echo "ERROR: npm install playwright failed."
  echo "Check your network connection and try again."
  read -r -p "Press Return to close..."
  exit 1
fi

echo
echo "Step 2 of 2: Downloading the Chromium browser (about 250 MB)..."
echo
if ! npx playwright install chromium; then
  echo
  echo "ERROR: Chromium download failed."
  echo "Check your network connection and try again."
  read -r -p "Press Return to close..."
  exit 1
fi

echo
echo "================================"
echo "  Done! Playwright is ready."
echo "================================"
echo
echo "You can now run the Refresh Sora Assets pipeline (step 3, Fetch HTML)"
echo "from the Server panel in Sora View Lite."
echo
read -r -p "Press Return to close..."
