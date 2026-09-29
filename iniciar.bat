@echo off
title Tuerca Store
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js. Descargalo e instalalo desde https://nodejs.org ^(version LTS^)
  echo  y despues volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODEMAJOR=%%a
if %NODEMAJOR% LSS 20 (
  echo.
  echo  Tu version de Node.js es muy vieja. Instala la version LTS desde https://nodejs.org
  echo  y despues volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
echo Revisando dependencias...
call npm install --omit=dev --no-audit --no-fund --loglevel=error
start "" http://localhost:3000
node server.js
pause
