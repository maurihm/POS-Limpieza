$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host "Buscando instalador oficial de Node.js 24 LTS para Windows..." -ForegroundColor Cyan

$FallbackUrl = "https://nodejs.org/dist/v24.13.1/node-v24.13.1-x64.msi"
$DownloadUrl = $FallbackUrl

try {
    $releases = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 15
    $v24 = $releases | Where-Object { $_.version -like "v24.*" } | Select-Object -First 1
    if ($v24 -and $v24.version) {
        $ver = $v24.version
        $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
        $DownloadUrl = "https://nodejs.org/dist/$ver/node-$ver-$arch.msi"
    }
} catch {
    Write-Host "Usando enlace directo de respaldo ($FallbackUrl)..." -ForegroundColor Yellow
}

$InstallerPath = Join-Path $env:TEMP "nodejs-24-lts.msi"
Write-Host "Descargando $DownloadUrl ..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $DownloadUrl -OutFile $InstallerPath -UseBasicParsing

Write-Host "Instalando Node.js 24 LTS (acepta la ventana de permisos si aparece)..." -ForegroundColor Green
$proc = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$InstallerPath`" /qb" -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    throw "El instalador de Node.js termino con codigo $($proc.ExitCode)."
}

Remove-Item -Force -ErrorAction SilentlyContinue $InstallerPath
Write-Host "Node.js 24 LTS instalado correctamente." -ForegroundColor Green
