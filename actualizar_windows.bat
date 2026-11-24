@echo off
title Actualizar POS Limpieza
cd /d "%~dp0"

if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

echo ========================================================
echo           ACTUALIZANDO POS LIMPIEZA DESDE GIT
echo ========================================================
echo.

echo [1/4] Deteniendo servidor actual (tu base de datos esta segura)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\detener_pos.ps1"

echo [2/4] Descargando cambios (git pull)...
where git >nul 2>nul
if %errorlevel% equ 0 (
    git pull
) else (
    echo Aviso: Git no esta instalado. Continuando con archivos locales...
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
