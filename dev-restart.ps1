# Build frontend + restart Flask dev server
param(
    [switch]$SkipBuild,
    [int]$Port = 5000
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Kill ALL processes listening on the target port (loop until clear)
$maxRetries = 5
for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
    $existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Where-Object State -eq 'Listen' |
        Select-Object -ExpandProperty OwningProcess -Unique
    if (-not $existing) { break }
    foreach ($procId in $existing) {
        Write-Host "Stopping process on port $Port (PID $procId, attempt $attempt)..."
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}
$stillListening = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object State -eq 'Listen'
if ($stillListening) {
    Write-Error "Could not free port $Port after $maxRetries attempts."
    return
}

# Build frontend
if (-not $SkipBuild) {
    Write-Host "`n--- Building frontend ---"
    Push-Location "$root\frontend"
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Write-Error "Frontend build failed."
        return
    }
    Pop-Location
    Write-Host "Frontend build complete.`n"
} else {
    Write-Host "Skipping frontend build (-SkipBuild).`n"
}

# Start Flask
Write-Host "--- Starting Flask on port $Port ---"
& "$root\.venv\bin\python.exe" -B -m flask --app LapForge.app run --port $Port
