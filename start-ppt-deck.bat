@echo off
setlocal
cd /d "%~dp0"
title PPT Stage Deck Controller

echo ===================================================
echo   Starting PPT Stage Deck Server (Port 8890)...
echo ===================================================

:: 1. Clean up any orphaned process on port 8890 and stale PowerPoint COM
echo Cleaning up stale processes...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8890" ^| findstr "LISTENING"') do (
    echo Killing stale process PID %%a on port 8890...
    taskkill /F /PID %%a >nul 2>&1
)
taskkill /F /IM POWERPNT.EXE >nul 2>&1

:: 2. Launch node server (prefer bundled portable runtime\node.exe or node.exe)
set "NODE_BIN=node"
if exist "%~dp0runtime\node.exe" set "NODE_BIN=%~dp0runtime\node.exe"
if exist "%~dp0node.exe" set "NODE_BIN=%~dp0node.exe"

echo Launching server.mjs using "%NODE_BIN%"...
"%NODE_BIN%" server.mjs

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server exited with error code %errorlevel%.
    pause
)
