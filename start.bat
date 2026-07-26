@echo off
title Church Live Translation Server
echo ========================================
echo   Church Live Translation
echo ========================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist node_modules (
    echo [SETUP] Installing dependencies...
    call npm install
    echo.
)

echo [START] Starting servers...
echo   - Next.js:  http://localhost:3000
echo   - WS:       ws://localhost:3001
echo.
echo   Admin:  http://localhost:3000/admin
echo   Stop:   Press Ctrl+C or close this window
echo ========================================
echo.

:: Run both servers concurrently
start "WS Server" cmd /c "node --env-file=.env --import tsx src/server/ws/server.ts"
call npm run dev
