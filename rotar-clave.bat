@echo off
title Tuerca Store - cambiar clave de cifrado
cd /d "%~dp0"
echo.
echo  Este programa genera una clave de cifrado NUEVA y vuelve a cifrar los datos de clientes.
echo  IMPORTANTE: cerra la tienda (la ventana negra de iniciar.bat) antes de seguir.
echo.
pause
node rotar-clave.js
echo.
pause
