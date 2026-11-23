param([switch]$PublicMyFcu)
# Isolated single-machine mock only. Does not connect to Aiven.
$ErrorActionPreference = 'Stop'
$serverDir = Split-Path -Parent $PSScriptRoot
$bundledModules = 'C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt\dependencies\node\node_modules'
if (Test-Path -LiteralPath (Join-Path $bundledModules 'playwright')) { $env:NODE_PATH = $bundledModules }
$env:CONTROLLED_BROWSER_MOCK = if ($PublicMyFcu) { 'false' } else { 'true' }
$env:CONTROLLED_BROWSER_REAL_TEST = if ($PublicMyFcu) { 'true' } else { 'false' }
$env:COURSE_HISTORY_IMPORT_ENABLED = 'false'
$env:COURSE_HISTORY_IMPORT_FIXTURE = if ($PublicMyFcu) { 'false' } else { 'true' }
$env:NODE_ENV = 'test'
$env:ALLOW_LEGACY_JSON_AUTH = 'true'
$env:PRIVACY_STORE = 'memory'
$env:PRIVACY_ENFORCEMENT_ENABLED = if ($PublicMyFcu) { 'true' } else { 'false' }
if ($PublicMyFcu) { $env:PRIVACY_DATA_KEY_V1 = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)) }
$env:CF_INTEREST_MODE = 'off'
$env:DB_HOST = ''
$env:DB_USER = ''
$env:DB_NAME = ''
$env:DB_PASSWORD = ''
$env:DB_SSL_CA_PATH = ''
$env:DATA_DIR = Join-Path $serverDir 'test\fixtures\account-isolation'
$env:ANALYTICS_ID_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:SESSION_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:CLIENT_ORIGIN = 'http://localhost:5173'
$env:PORT = '3001'
Set-Location -LiteralPath $serverDir
Write-Host 'Starting loopback-only test. Public MyFCU mode is view-only; never enter school credentials.'
node src/app.js
