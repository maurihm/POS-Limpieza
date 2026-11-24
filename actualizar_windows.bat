@echo off
chcp 65001 >nul
title Actualizar POS Limpieza
cd /d "%~dp0"

echo ========================================================
echo           ACTUALIZANDO POS LIMPIEZA DESDE GIT
echo ========================================================
echo.

echo [1/4] Deteniendo servidor actual (tu base de datos esta segura)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\detener_pos.ps1"

echo [2/4] Descargando cambios (git pull)...
git pull
if %errorlevel% neq 0 (
    echo Aviso: no se pudo ejecutar git pull. Continuando con archivos locales...
)

echo [3/4] Actualizando dependencias y compilando...
call npm install
call npm run build
if %errorlevel% neq 0 (
    echo ERROR durante la compilacion.
    pause
    exit /b 1
)

echo [4/4] Iniciando POS Limpieza actualizado...
wscript.exe "%~dp0scripts\windows\launch_pos.vbs"
echo Listo!
timeout /t 3 >nul
exit /b 0
