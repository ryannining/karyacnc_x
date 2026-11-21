# build-windows.ps1 — Build KaryaCNC untuk Windows
#
# Sumber: share SMB (Z:\git\wails\karyacnc).
# Sync source ke folder lokal (folder script ini), lalu wails build.
#
# Cara pakai:
#   .\build-windows.ps1              # sync + build
#   .\build-windows.ps1 -SyncOnly    # hanya sync
#   .\build-windows.ps1 -NoSync      # build saja (source lokal terakhir)
#
# Prasyarat: Go + Wails CLI terinstall (cek: go version, wails version)

param(
    [switch]$SyncOnly,
    [switch]$NoSync
)

$ErrorActionPreference = "Stop"

# ===== Konfigurasi =====
$SHARE = "Z:\git\wails\karyacnc"
if (-not (Test-Path $SHARE)) {
    $candidates = @("Z:\git\wails\karyacnc", "Y:\git\wails\karyacnc", "\\192.168.1.159\users\ryan\Documents\git\wails\karyacnc")
    foreach ($c in $candidates) {
        if (Test-Path $c) { $SHARE = $c; break }
    }
}
if (-not (Test-Path $SHARE)) {
    Write-Host "ERROR: share tidak ditemukan. Set `$SHARE manual di baris 15 script ini." -ForegroundColor Red
    exit 1
}

$LOCAL = $PSScriptRoot
Write-Host "=== KaryaCNC Windows Build ===" -ForegroundColor Cyan
Write-Host "Source : $SHARE"
Write-Host "Build  : $LOCAL"
Write-Host ""

# ===== 1) Sync dari share =====
if (-not $NoSync) {
    Write-Host ">>> Sinkronisasi source dari $SHARE ..." -ForegroundColor Yellow

    robocopy $SHARE $LOCAL /MIR /XD ".git" "node_modules" "dist" "bin" "build" "backup" "linux-patch" ".commandcode" "webprofile" /XF "karyacnc.exe" "karyacnc" "*.tar.gz" "nul" "build-windows.ps1" "build-linux.sh" /NFL /NDL /NJH /NJS /NP
    # robocopy exit codes 0-7 = sukses
    if ($LASTEXITCODE -ge 8) {
        Write-Host "ERROR: robocopy gagal (code $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
    Write-Host ">>> Sinkron selesai." -ForegroundColor Green
    Write-Host ""
}

# ===== 2) Build frontend =====
if (-not $SyncOnly) {
    Write-Host ">>> Build frontend (vite) ..." -ForegroundColor Yellow
    Push-Location "$LOCAL\frontend"
    if (-not (Test-Path "node_modules")) {
        Write-Host ">>> npm install (pertama kali) ..." -ForegroundColor Yellow
        npm install
        if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: npm install gagal" -ForegroundColor Red; exit 1 }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: vite build gagal" -ForegroundColor Red; exit 1 }
    Pop-Location
    Write-Host ">>> Frontend OK." -ForegroundColor Green
    Write-Host ""

    # ===== 3) Build backend =====
    Write-Host ">>> Compile backend (wails build) ..." -ForegroundColor Yellow
    Push-Location $LOCAL
    wails build
    if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: wails build gagal" -ForegroundColor Red; exit 1 }
    Pop-Location

    $bin = "$LOCAL\build\bin\karyacnc.exe"
    if (Test-Path $bin) {
        Write-Host ""
        Write-Host "=== SELESAI ===" -ForegroundColor Cyan
        Write-Host "Binary: $bin"
        $size = (Get-Item $bin).Length / 1MB
        Write-Host ("Size  : {0:N1} MB" -f $size)
    } else {
        Write-Host "ERROR: binary tidak ditemukan: $bin" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host ">>> Done (sync-only). SKIP build." -ForegroundColor Green
}
