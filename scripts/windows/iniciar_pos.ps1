$ErrorActionPreference = "SilentlyContinue"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Url = "http://127.0.0.1:3420"
$HealthUrl = "$Url/api/bootstrap"

function Resolve-NodeExe {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LocalAppData\Programs\nodejs\node.exe"
    )
    return ($candidates | Where-Object { Test-Path $_ } | Select-Object -First 1)
}

function Test-PosRunning {
    try {
        $resp = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
        return ($resp.StatusCode -eq 200)
    } catch {
        return $false
    }
}

if (-not (Test-PosRunning)) {
    $NodeExe = Resolve-NodeExe
    if (-not $NodeExe) {
        [System.Windows.Forms.MessageBox]::Show("No se encontro Node.js. Ejecuta instalar_windows.bat primero.", "POS Limpieza") | Out-Null
        exit 1
    }
    $TsxCli = Join-Path $RootDir "node_modules\tsx\dist\cli.mjs"
    $ServerEntry = Join-Path $RootDir "src-server\index.ts"
    $LogDir = Join-Path $RootDir "data"
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

    $env:NODE_ENV = "production"
    Start-Process -FilePath $NodeExe `
        -ArgumentList "`"$TsxCli`" `"$ServerEntry`"" `
        -WorkingDirectory $RootDir `
        -WindowStyle Hidden

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 350
        if (Test-PosRunning) { break }
    }
}

$ProfileDir = Join-Path $RootDir "data\app-profile"
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

$BrowserCandidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)

$Browser = $BrowserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($Browser) {
    Start-Process -FilePath $Browser -ArgumentList "--app=$Url --start-maximized --user-data-dir=`"$ProfileDir`""
} else {
    Start-Process $Url
}
