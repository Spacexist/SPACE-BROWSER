@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0memory-manage\load-white-list.ps1"

start "" "ui/index.html"

endlocal
