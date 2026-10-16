$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath "$projectRoot/frontend"
npm run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
Set-Location -LiteralPath $projectRoot
& '.venv/Scripts/python.exe' -m pytest -q
if ($LASTEXITCODE -ne 0) { throw '业务测试失败' }
& '.venv/Scripts/python.exe' -m PyInstaller --noconfirm desktop/XianBiz.spec
if ($LASTEXITCODE -ne 0) { throw '打包失败' }
$innoCompiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
$innoPath = if ($innoCompiler) { $innoCompiler.Source } else { "$projectRoot/.tools/InnoSetup/ISCC.exe" }
if (!(Test-Path -LiteralPath $innoPath)) { throw '桌面程序已构建；安装程序需要 Inno Setup 6 的 ISCC.exe' }
& $innoPath installer/XianBiz.iss
if ($LASTEXITCODE -ne 0) { throw '安装程序构建失败' }
