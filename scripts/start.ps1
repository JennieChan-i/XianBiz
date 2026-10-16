$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
if (!(Test-Path -LiteralPath '.venv/Scripts/pythonw.exe')) { throw '请先执行 python -m venv .venv 并安装 requirements.txt' }
if (!(Test-Path -LiteralPath 'frontend/dist/index.html')) { throw '请先在 frontend 执行 npm install 和 npm run build' }
Start-Process -FilePath "$projectRoot/.venv/Scripts/pythonw.exe" -ArgumentList @('desktop/launcher.py') -WorkingDirectory $projectRoot -WindowStyle Hidden
