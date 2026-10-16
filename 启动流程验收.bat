@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0dist\XianBiz\XianBiz.exe" (
  echo Packaged application not found. Build XianBiz first.
  pause
  exit /b 1
)
start "" "%~dp0dist\XianBiz\XianBiz.exe" --data-dir "%~dp0.runtime\manual-acceptance"
endlocal
