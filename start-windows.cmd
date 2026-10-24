@echo off
setlocal
cd /d "%~dp0"
if exist "src-tauri\target\release\every-directory.exe" (
  start "" "src-tauri\target\release\every-directory.exe"
  exit /b 0
)
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or later: https://nodejs.org/
  pause
  exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo Install Rust and Tauri prerequisites: https://v2.tauri.app/start/prerequisites/
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
call npm run desktop:dev
pause
