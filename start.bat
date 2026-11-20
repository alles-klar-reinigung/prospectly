@echo off
chcp 65001 >nul
title Prospectly v2
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js wurde nicht gefunden. Bitte die LTS-Version von https://nodejs.org installieren,
  echo den Computer neu starten und start.bat erneut oeffnen.
  echo.
  pause
  exit /b 1
)
set ADMIN_TOKEN=MK1
set NO_BROWSER=1
start "" cloudflared.exe tunnel --url http://localhost:3000
node server.js
pause
