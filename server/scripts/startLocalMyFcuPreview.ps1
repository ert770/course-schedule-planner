param([switch]$SessionImport)
# Explicit local-only preview. This does not enable import or verify MyFCU identity.
$ErrorActionPreference = 'Stop'
$modules = $env:CSP_PLAYWRIGHT_MODULES
if ($modules -and (Test-Path -LiteralPath (Join-Path $modules 'playwright'))) { $env:NODE_PATH = $modules }
$env:NODE_ENV = 'development'
if ($SessionImport) {
  $serverRoot = Split-Path -Parent $PSScriptRoot
  $envPath = Join-Path $serverRoot '.env'
  if (-not (Test-Path -LiteralPath $envPath)) { $envPath = Join-Path (Split-Path -Parent $serverRoot) '.env' }
  if (-not (Test-Path -LiteralPath $envPath)) { throw '找不到本機 .env；請先設定既有 Aiven 連線。' }
  $env:MYFCU_SESSION_IMPORT = 'true'
}
$env:LOCAL_MYFCU_PREVIEW = 'true'
$env:CONTROLLED_BROWSER_MOCK = 'false'
$env:CONTROLLED_BROWSER_REAL_TEST = 'false'
$env:CONTROLLED_BROWSER_PERSONAL_TEST = 'false'
$env:ISOLATED_HISTORY_MYSQL_E2E = 'false'
$env:LOCAL_MYFCU_SYNTHETIC_E2E = 'false'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if ($SessionImport) { Write-Host 'Local session import enabled. MyFCU identity is not verified; import requires explicit confirmation.' } else { Write-Host 'Local preview: remote databases blocked; import disabled.' }
if ($SessionImport) { node "--env-file=$envPath" src/app.js } else { node src/app.js }
