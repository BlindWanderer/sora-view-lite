@echo off
setlocal

title Sora View Lite - Install Playwright

echo.
echo ================================
echo   Sora View Lite
echo   Install Playwright + Chromium
echo ================================
echo.
echo This installs the Playwright package and the Chromium browser binary
echo that the Refresh Sora Assets pipeline needs for step 3 (Fetch HTML).
echo.
echo You only need to do this once. The download is roughly 250 MB.
echo.

REM Check Node
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Please install Node.js 20.19+ or 22.12+ from https://nodejs.org and try again.
  pause
  exit /b 1
)

for /f "tokens=*" %%i in ('node -e "const [maj,min]=process.versions.node.split('.').map(Number); process.stdout.write((maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19)) ? 'ok' : 'bad')"') do set NODE_OK=%%i
if "%NODE_OK%" neq "ok" (
  echo ERROR: Sora View Lite requires Node.js 20.19+ or 22.12+.
  echo Current Node.js version:
  node --version
  pause
  exit /b 1
)

echo Node:
node --version
echo.

REM Check npm
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found.
  echo Please reinstall Node.js with npm included.
  pause
  exit /b 1
)

echo Step 1 of 2: Installing the Playwright package...
echo.
call npm install playwright --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo ERROR: npm install playwright failed.
  echo Check your network connection and try again.
  pause
  exit /b 1
)

echo.
echo Step 2 of 2: Downloading the Chromium browser (about 250 MB)...
echo.
call npx playwright install chromium
if errorlevel 1 (
  echo.
  echo ERROR: Chromium download failed.
  echo Check your network connection and try again.
  pause
  exit /b 1
)

echo.
echo ================================
echo   Done! Playwright is ready.
echo ================================
echo.
echo You can now run the Refresh Sora Assets pipeline (step 3, Fetch HTML)
echo from the Server panel in Sora View Lite.
echo.
pause
endlocal
