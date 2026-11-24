$ErrorActionPreference = "SilentlyContinue"
$procs = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -like "*src-server*index.ts*"
}
foreach ($p in $procs) {
    Stop-Process -Id $p.ProcessId -Force
}
Write-Host "Servidor POS Limpieza detenido correctamente."
