$ErrorActionPreference = 'Stop'
$modules = 'C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt\dependencies\node\node_modules'
if (Test-Path -LiteralPath (Join-Path $modules 'playwright')) { $env:NODE_PATH = $modules }
node (Join-Path $PSScriptRoot 'diagnoseMyFcuNavigation.mjs')
exit $LASTEXITCODE
