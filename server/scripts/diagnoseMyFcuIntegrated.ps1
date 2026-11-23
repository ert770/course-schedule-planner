param([switch]$ObserveLogin, [switch]$BlockUnknownPost, [switch]$ComparePosts, [switch]$PersonalPolicy, [switch]$ProbeTabs, [switch]$PublicResources)
$ErrorActionPreference = 'Stop'
$modules = 'C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt\dependencies\node\node_modules'
if (Test-Path -LiteralPath (Join-Path $modules 'playwright')) { $env:NODE_PATH = $modules }
if ($PublicResources -and ($ObserveLogin -or $PersonalPolicy -or $ProbeTabs -or $ComparePosts -or $BlockUnknownPost)) { Write-Error 'PublicResources 必須獨立執行'; exit 1 }
if (($PersonalPolicy -or $ProbeTabs) -and -not ($ObserveLogin -and $PersonalPolicy -and $ProbeTabs)) { Write-Error 'PersonalPolicy 與 ProbeTabs 必須同時搭配 ObserveLogin'; exit 1 }
if ($PublicResources) { node (Join-Path $PSScriptRoot 'diagnoseMyFcuIntegrated.mjs') --public-resources }
elseif ($ObserveLogin -and $PersonalPolicy -and $ProbeTabs) { node (Join-Path $PSScriptRoot 'diagnoseMyFcuIntegrated.mjs') --observe-login --personal-policy --probe-tabs }
elseif ($ComparePosts) { node (Join-Path $PSScriptRoot 'diagnoseMyFcuIntegrated.mjs') --compare-posts }
elseif ($ObserveLogin -and $BlockUnknownPost) { node (Join-Path $PSScriptRoot 'diagnoseMyFcuIntegrated.mjs') --observe-login --block-unknown-post }
elseif ($ObserveLogin) { node (Join-Path $PSScriptRoot 'diagnoseMyFcuIntegrated.mjs') --observe-login }
else { node (Join-Path $PSScriptRoot 'diagnoseMyFcuIntegrated.mjs') }
exit $LASTEXITCODE
