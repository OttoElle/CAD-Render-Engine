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

if not exist node_modules (
  echo Erster Start: Abhaengigkeiten werden installiert ...
  call npm install
  if errorlevel 1 (
    echo Die Installation ist fehlgeschlagen.
    pause
    exit /b 1
  )
)

echo CAD Render Engine startet. Dieses Fenster offen lassen, zum Beenden schliessen.
call npm run dev -- --open
if errorlevel 1 pause
