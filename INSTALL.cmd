@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing
call npm ci --prefix backend --no-audit --no-fund
if errorlevel 1 goto failed
if not exist "backend\.env" copy "backend\.env.example" "backend\.env" >nul
if exist "admin\dist\index.html" goto ready
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
call npm ci --prefix admin --no-audit --no-fund
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
:ready
echo Installation complete. Configure backend\.env and run the database SQL files.
echo Then run START.cmd.
pause
exit /b 0
:missing
echo Install Node.js 22 or later, then run INSTALL.cmd again.
pause
exit /b 1
:failed
echo Installation failed. Review the error above.
pause
exit /b 1
