@echo off
setlocal

title Sora View Lite - Production

echo.
echo ================================
echo        Sora View Lite
echo        Production Mode
echo ================================
echo.

REM App server settings. HOST can be overridden before launching.
if not defined HOST set HOST=127.0.0.1
if not defined PORT set PORT=5173
set URL=http://localhost:%PORT%

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

REM If config.json requests LAN mode and HOST was not manually changed, listen on the LAN.
if "%HOST%"=="127.0.0.1" (
  for /f "tokens=*" %%i in ('node -e "const fs=require(`fs`);try{const c=JSON.parse(fs.readFileSync(`config.json`,`utf8`));process.stdout.write(c.serverAccessMode===`lan`?`0.0.0.0`:`127.0.0.1`)}catch{process.stdout.write(`127.0.0.1`)}"') do set HOST=%%i
)

REM Check npm
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found.
  echo Please reinstall Node.js with npm included.
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
  echo then delete the node_modules folder and run start.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo Building production app...
call npm run build
if errorlevel 1 (
  echo.
  echo ERROR: Production build failed.
  pause
  exit /b 1
)

echo.
echo Starting Sora View Lite at %URL%
echo Bind host: %HOST%
echo.
echo Leave this window open while using the app.
echo Press Ctrl+C to stop the server.
echo.

REM Open browser shortly after server starts
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"

REM Start production server in foreground
set NODE_ENV=production
set ORIGIN=%URL%
REM Disable adapter-node's 512 KB body-size cap. The app is local-first
REM and uploads JSON metadata dumps (Data & Database tab) that routinely
REM run into the megabytes.
set BODY_SIZE_LIMIT=Infinity
call npm run start

echo.
echo Server stopped.
pause
endlocal
