@echo off
rem Starts the CAD Render Engine and opens it in the default browser.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte Node.js ab Version 20 von https://nodejs.org installieren und erneut starten.
  pause
  exit /b 1
)

rem Runs on every start so that dependencies added by an update get installed.
rem It only takes a moment when everything is already up to date.
echo Abhaengigkeiten werden geprueft ...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo Die Installation der Abhaengigkeiten ist fehlgeschlagen.
  pause
  exit /b 1
)

echo CAD Render Engine startet. Dieses Fenster offen lassen, zum Beenden schliessen.
call npm run dev -- --open
if errorlevel 1 pause
