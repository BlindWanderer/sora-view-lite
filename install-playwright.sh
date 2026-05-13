#!/usr/bin/env bash
# Linux installer for Playwright + Chromium.
# Run from a terminal:  ./install-playwright.sh
# (or right-click in your file manager and choose "Run in terminal")

set -euo pipefail
cd "$(dirname "$0")"

printf '\n================================\n'
printf '  Sora View Lite\n'
printf '  Install Playwright + Chromium\n'
printf '================================\n\n'
printf 'This installs the Playwright package and the Chromium browser binary\n'
printf 'that the Refresh Sora Assets pipeline needs for step 3 (Fetch HTML).\n\n'
printf 'You only need to do this once. The download is roughly 250 MB.\n\n'

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

echo "Step 1 of 2: Installing the Playwright package..."
echo
if ! npm install playwright --no-audit --no-fund; then
  echo
  echo "ERROR: npm install playwright failed."
  echo "Check your network connection and try again."
  exit 1
fi

echo
echo "Step 2 of 2: Downloading the Chromium browser (about 250 MB)..."
echo
if ! npx playwright install chromium; then
  echo
  echo "ERROR: Chromium download failed."
  echo "On some Linux distros Chromium also needs OS libraries; in that case run:"
  echo "    npx playwright install-deps chromium"
  echo "and retry."
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
