# ============================================================
#  install_windows.ps1
#  Installs pdf2svg (KaryaCNC PDF optimiser) on Windows.
#
#  - Checks / installs Python 3
#  - Installs PyMuPDF
#  - Registers a right-click context menu entry for PDF files
#  - Registers in the "Open with" program list
#
#  Run from an elevated or normal PowerShell:
#    powershell -ExecutionPolicy Bypass -File install_windows.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$AppFriendlyName = "Optimize to SVG (KaryaCNC)"
$AppName = "pdf2svg"

# --- locate this script directory (absolute, no UNC) ---
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$ScriptDir = (Get-Item $ScriptDir).FullName
$PyScript  = Join-Path $ScriptDir "pdf2svg.py"
$BatScript = Join-Path $ScriptDir "pdf2svg.bat"

function Write-Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "    ERROR: $msg" -ForegroundColor Red }
function Write-Warn($msg) { Write-Host "    WARN: $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== pdf2svg (KaryaCNC) installer for Windows ===" -ForegroundColor White
Write-Host ""

# ------------------------------------------------------------
# 1. Check Python 3
# ------------------------------------------------------------
Write-Step "Checking Python 3..."

$py = $null
foreach ($candidate in @("py", "python", "python3")) {
    try {
        $ver = & $candidate --version 2>&1
        if ($LASTEXITCODE -eq 0 -and "$ver" -match "Python 3") {
            $py = $candidate
            Write-Ok "Found $ver ($candidate)"
            break
        }
    } catch { }
}

if (-not $py) {
    Write-Warn "Python 3 not found."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Step "Attempting to install Python via winget..."
        winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
        # refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Machine")
        foreach ($candidate in @("py", "python", "python3")) {
            try {
                $ver = & $candidate --version 2>&1
                if ($LASTEXITCODE -eq 0 -and "$ver" -match "Python 3") { $py = $candidate; Write-Ok "Installed $ver"; break }
            } catch { }
        }
    }
    if (-not $py) {
        Write-Err "Python 3 could not be found or installed automatically."
        Write-Host ""
        Write-Host "    Please install Python 3.8+ manually from:" -ForegroundColor Yellow
        Write-Host "      https://www.python.org/downloads/" -ForegroundColor Yellow
        Write-Host "    Be sure to tick 'Add Python to PATH' during setup," -ForegroundColor Yellow
        Write-Host "    then re-run this installer." -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ------------------------------------------------------------
# 2. Install PyMuPDF
# ------------------------------------------------------------
Write-Step "Installing PyMuPDF..."
$pipCmd = if ($py -eq "py") { "py -m pip" } else { "$py -m pip" }
& cmd /c "$pipCmd install pymupdf --quiet --disable-pip-version-check 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Err "pip install pymupdf failed."
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "PyMuPDF installed."

# ------------------------------------------------------------
# 3. Verify the converter runs
# ------------------------------------------------------------
Write-Step "Verifying converter..."
$helpLine = & cmd /c "$py `"$PyScript`" --help 2>&1" | Select-Object -First 1
if (-not $helpLine) {
    Write-Err "Could not run pdf2svg.py. Check that the file exists: $PyScript"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "Converter OK."

# ------------------------------------------------------------
# 4. Register context-menu entry (right-click on .pdf)
# ------------------------------------------------------------
Write-Step "Registering right-click context menu for PDF files..."

$menuKey = "HKCU:\Software\Classes\SystemFileAssociations\.pdf\shell\$AppName"
New-Item -Path $menuKey -Force | Out-Null
Set-ItemProperty -Path $menuKey -Name "(Default)"  -Value $AppFriendlyName
Set-ItemProperty -Path $menuKey -Name "Icon"       -Value "shell32.dll,70"

New-Item -Path "$menuKey\command" -Force | Out-Null
Set-ItemProperty -Path "$menuKey\command" -Name "(Default)" -Value "`"$BatScript`" `"%1`""
Write-Ok "Context menu: right-click PDF  ->  '$AppFriendlyName'"

# ------------------------------------------------------------
# 5. Register in "Open with" program list
# ------------------------------------------------------------
Write-Step "Registering in 'Open with' list..."

$appKey = "HKCU:\Software\Classes\Applications\$AppName.exe"
New-Item -Path $appKey -Force | Out-Null
Set-ItemProperty -Path $appKey -Name "FriendlyAppName" -Value $AppFriendlyName

New-Item -Path "$appKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$appKey\shell\open\command" -Name "(Default)" -Value "`"$BatScript`" `"%1`""

$owlKey = "HKCU:\Software\Classes\.pdf\OpenWithList\$AppName"
New-Item -Path $owlKey -Force | Out-Null
Write-Ok "'Open with' list registered."

# ------------------------------------------------------------
# 6. Done
# ------------------------------------------------------------
Write-Host ""
Write-Host "=== Installation complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "How to use:" -ForegroundColor White
Write-Host "  1. Right-click any PDF  ->  '$AppFriendlyName'"
Write-Host "  2. Or: Open with  ->  Choose another app  ->  $AppFriendlyName"
Write-Host "  3. Or: drag-drop a PDF onto  $BatScript"
Write-Host ""
Write-Host "Output: the SVG is written next to the source PDF"
Write-Host "        as <filename>_optimized.svg"
Write-Host ""
Read-Host "Press Enter to close"
