@echo off
REM ============================================================
REM  pdf2svg drag-and-drop wrapper
REM  Drag a PDF file onto this .bat to produce an optimized SVG.
REM  Output: <filename>_optimized.svg in the same folder.
REM ============================================================
setlocal

set "SCRIPT=%~dp0pdf2svg.py"

if "%~1"=="" (
    echo Usage: drag a PDF file onto this .bat file.
    echo Or run: pdf2svg.bat input.pdf [options...]
    echo.
    pause
    exit /b 1
)

set "IN=%~1"
set "OUT=%~dpn1_optimized.svg"

REM Forward any additional args (shift past the first)
shift
set "REST="
:argloop
if "%~1"=="" goto afterargs
set "REST=%REST% %~1"
shift
goto argloop
:afterargs

python "%SCRIPT%" "%IN%" -o "%OUT%" -p 0 -t 0.15 -s 1 --stats %REST%

echo.
echo Done. Output: %OUT%
pause
