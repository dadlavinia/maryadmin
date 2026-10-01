@echo off
setlocal
cd /d "%~dp0"
start "Mary Collections API" /D "%~dp0backend" cmd /k "npm run dev"
start "Mary Collections Admin" /D "%~dp0admin" cmd /k "npm run dev"
timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:3001"
