@echo off
chcp 65001 >nul
title Desinstalar Accesos - POS Limpieza
cd /d "%~dp0"

echo Deteniendo servidor POS Limpieza...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\detener_pos.ps1"

echo Eliminando accesos directos de Escritorio y Menu Inicio...
powershell.exe -NoProfile -Command "Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath('Desktop')) 'POS Limpieza.lnk'); Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath('Programs')) 'POS Limpieza')"

echo.
echo Accesos directos eliminados.
echo Nota: Tu base de datos (carpeta data\) y respaldos (backups\) NO fueron borrados.
pause
exit /b 0
