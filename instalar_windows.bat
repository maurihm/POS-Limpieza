@echo off
chcp 65001 >nul
title Instalador - POS Limpieza
cd /d "%~dp0"

echo ========================================================
echo          INSTALADOR DE POS LIMPIEZA (WINDOWS)
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [1/4] Node.js no encontrado. Intentando instalar Node.js LTS con winget...
    where winget >nul 2>nul
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: No se encontro Node.js ni winget.
        echo Descarga e instala Node.js 24 LTS desde https://nodejs.org y vuelve a ejecutar este instalador.
        pause
        exit /b 1
    )
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    echo.
    echo Node.js instalado. Cierra esta ventana y vuelve a abrir instalar_windows.bat para continuar.
    pause
    exit /b 0
)

for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_MAJOR=%%v
echo [1/4] Node.js detectado: %NODE_MAJOR%
echo.

echo [2/4] Instalando dependencias del sistema (puede tardar 30-60 seg)...
call npm install
if %errorlevel% neq 0 (
    echo ERROR durante npm install. Verifica tu conexion a internet.
    pause
    exit /b 1
)
echo.

echo [3/4] Compilando interfaz de usuario...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR durante la compilacion.
    pause
    exit /b 1
)
echo.

echo [4/4] Creando programa "POS Limpieza" en Escritorio y Menu Inicio...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\crear_accesos.ps1"
echo.

echo ========================================================
echo   INSTALACION COMPLETADA CON EXITO
echo   Ya puedes abrir "POS Limpieza" desde tu Escritorio.
echo   PIN inicial Admin: 0000  ^|  Cajero (Ana): 1234
echo ========================================================
echo.
set /p RUNNOW=¿Deseas abrir POS Limpieza ahora mismo? (S/N): 
if /I "%RUNNOW%"=="S" (
    wscript.exe "%~dp0scripts\windows\launch_pos.vbs"
)
exit /b 0
