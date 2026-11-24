$ErrorActionPreference = "Stop"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$VbsLauncher = Join-Path $RootDir "scripts\windows\launch_pos.vbs"
$IconPath = Join-Path $RootDir "assets\pos-icon.ico"
$UpdateBat = Join-Path $RootDir "actualizar_windows.bat"
$StopPs = Join-Path $RootDir "scripts\windows\detener_pos.ps1"

$WshShell = New-Object -ComObject WScript.Shell

function New-Shortcut($LinkPath, $TargetPath, $Arguments, $Description) {
    $Shortcut = $WshShell.CreateShortcut($LinkPath)
    $Shortcut.TargetPath = $TargetPath
    if ($Arguments) { $Shortcut.Arguments = $Arguments }
    $Shortcut.WorkingDirectory = $RootDir
    $Shortcut.Description = $Description
    if (Test-Path $IconPath) {
        $Shortcut.IconLocation = "$IconPath,0"
    }
    $Shortcut.Save()
}

# 1. Escritorio
$DesktopDir = [Environment]::GetFolderPath("Desktop")
New-Shortcut (Join-Path $DesktopDir "POS Limpieza.lnk") "wscript.exe" "`"$VbsLauncher`"" "Abrir Sistema Punto de Venta POS Limpieza"

# 2. Menú Inicio -> Programas -> POS Limpieza
$StartMenuDir = Join-Path ([Environment]::GetFolderPath("Programs")) "POS Limpieza"
New-Item -ItemType Directory -Force -Path $StartMenuDir | Out-Null

New-Shortcut (Join-Path $StartMenuDir "POS Limpieza.lnk") "wscript.exe" "`"$VbsLauncher`"" "Abrir Sistema Punto de Venta POS Limpieza"
New-Shortcut (Join-Path $StartMenuDir "Actualizar POS Limpieza.lnk") $UpdateBat "" "Descargar actualizaciones desde Git y recompilar"
New-Shortcut (Join-Path $StartMenuDir "Detener Servidor POS.lnk") "powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File `"$StopPs`"" "Detener servidor local de POS Limpieza"

Write-Host "Accesos directos creados en el Escritorio y Menu Inicio." -ForegroundColor Green
