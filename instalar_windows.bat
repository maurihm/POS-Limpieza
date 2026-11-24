@echo off
title Instalador - POS Limpieza
cd /d "%~dp0"

echo ========================================================
echo          INSTALADOR DE POS LIMPIEZA (WINDOWS)
echo ========================================================
echo.

if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [1/4] Node.js no encontrado. Descargando e instalando Node.js 24 LTS...
    echo.
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\instalar_node.ps1"
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: No se pudo instalar Node.js automaticamente.
        echo Descarga Node.js 24 LTS manualmente desde https://nodejs.org y vuelve a ejecutar este instalador.
        pause
        exit /b 1
    )
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "PATH=%ProgramFiles%\nodejs;%PATH%"
    )
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js se instalo pero requiere reiniciar esta ventana.
    echo Cierra esta ventana y vuelve a dar doble clic en instalar_windows.bat.
    pause
    exit /b 0
)

for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo [1/4] Node.js detectado: %NODE_VER%
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
set /p RUNNOW=Deseas abrir POS Limpieza ahora mismo? (S/N): 
if /I "%RUNNOW%"=="S" (
    wscript.exe "%~dp0scripts\windows\launch_pos.vbs"
)
exit /b 0
