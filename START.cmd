@echo off
setlocal
cd /d "%~dp0"
if not exist "backend\.env" goto setup
if not exist "admin\dist\index.html" goto setup
if not exist "backend\node_modules\express" goto setup
start "Mary Collections API" /D "%~dp0backend" cmd /k "npm start"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:4000"
exit /b 0
:setup
echo Run INSTALL.cmd and complete SETUP.md first.
pause
exit /b 1
