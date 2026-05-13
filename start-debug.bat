@echo off
setlocal

title Sora View Lite - Debug

echo.
echo ================================
echo        Sora View Lite
echo        Debug / Dev Mode
echo ================================
echo.

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

echo Checking dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo ERROR: npm install failed.
  echo.
  echo If this is an upgrade from an older ZIP, close editors/terminals using this folder,
  echo then delete the node_modules folder and run start-debug.bat again.
  pause
  exit /b 1
)

echo.
echo Starting Sora View Lite in debug/dev mode...
echo Open your browser to http://localhost:5173
echo Press Ctrl+C to stop.
echo.

call npm run dev
pause
endlocal
