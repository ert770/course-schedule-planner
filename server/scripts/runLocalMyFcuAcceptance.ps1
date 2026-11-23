param([switch]$Smoke, [string]$CatalogPath, [switch]$KeepEnvironment)
# Disposable Windows-only acceptance. MyFCU login is always performed by the user.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw '只允許 Windows 本機驗收。' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '請先啟動 Docker Desktop。' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '需要 Node.js。' }
if (-not $Smoke -and (-not $CatalogPath -or -not (Test-Path -LiteralPath $CatalogPath -PathType Leaf))) { throw '請提供已授權的本機課程目錄 JSON 快照（-CatalogPath），不讀取 Aiven。' }
if ($KeepEnvironment -and $env:LOCAL_ACCEPTANCE_WEBSITE_PASSWORD) { $testPassword = $env:LOCAL_ACCEPTANCE_WEBSITE_PASSWORD }
elseif ($Smoke) { $testPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16)) }
else { $secure = Read-Host '設定本機網站測試帳號密碼（勿使用校務密碼，至少 8 位）' -AsSecureString; $testPassword = [System.Net.NetworkCredential]::new('', $secure).Password }
if ($testPassword.Length -lt 8) { throw '本機測試密碼至少 8 位。' }
$name = 'codex-history-' + [Guid]::NewGuid().ToString('N').Substring(0,12)
$created = $false; $preserve = $false
$env:MYSQL_ROOT_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:MYSQL_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:MYSQL_USER = 'history_test'; $env:MYSQL_DATABASE = 'codex_bootstrap'
try {
  $dockerArgs = @('run','--detach'); if (-not $KeepEnvironment) { $dockerArgs += '--rm' }
  $dockerArgs += @('--name',$name,'--publish','127.0.0.1::3306','--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_PASSWORD','--env','MYSQL_USER','--env','MYSQL_DATABASE','mysql:8.4')
  docker @dockerArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '無法啟動隔離 MySQL，請檢查 Docker 及 33160。' }
  $created = $true; $mapping=(docker port $name 3306/tcp | Select-Object -First 1)
  if($mapping -notmatch '^127\.0\.0\.1:([0-9]{4,5})$'){throw '隔離埠無效。'}
  if($KeepEnvironment){$preserve=$true; Write-Host "保留隔離容器：$name；本機 MySQL 埠：$($Matches[1])。"}
  $env:LOCAL_MYFCU_ACCEPTANCE_PORT=$Matches[1];$env:MYSQL_PWD = $env:MYSQL_ROOT_PASSWORD; $ready = $false
  for ($i=0; $i -lt 60; $i++) { docker exec --env MYSQL_PWD $name mysql -uroot --execute 'SELECT 1' 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $ready=$true; break }; Start-Sleep -Seconds 1 }
  if (-not $ready) { throw '隔離 MySQL 未就緒。' }
  docker exec --env MYSQL_PWD $name mysql -uroot --execute "GRANT ALL PRIVILEGES ON *.* TO 'history_test'@'%';" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '無法設定隔離帳號。' }
  $env:LOCAL_ACCEPTANCE_DB_PASSWORD = $env:MYSQL_PASSWORD
  $env:LOCAL_ACCEPTANCE_LOGIN_PASSWORD = $testPassword
  if($CatalogPath){$env:LOCAL_ACCEPTANCE_CATALOG=(Resolve-Path -LiteralPath $CatalogPath).Path}
  $nodeArgs=@(); if ($Smoke) { $nodeArgs+='--smoke' }; if ($KeepEnvironment) { $nodeArgs+='--keep-environment' }
  node (Join-Path $PSScriptRoot 'runLocalMyFcuAcceptance.mjs') @nodeArgs
  if ($LASTEXITCODE -eq 74) { $preserve=$true; Write-Warning "未匹配報告匯出失敗；隔離容器 $name 仍在執行，請勿停止。" }
  if ($LASTEXITCODE -ne 0) { throw '本機驗收環境失敗。' }
} finally {
  if ($created -and -not $preserve -and -not $KeepEnvironment) { docker stop $name 2>$null | Out-Null }
  Remove-Item Env:MYSQL_ROOT_PASSWORD, Env:MYSQL_PASSWORD, Env:MYSQL_USER, Env:MYSQL_DATABASE, Env:MYSQL_PWD, Env:LOCAL_ACCEPTANCE_DB_PASSWORD, Env:LOCAL_ACCEPTANCE_LOGIN_PASSWORD, Env:LOCAL_ACCEPTANCE_CATALOG, Env:LOCAL_MYFCU_ACCEPTANCE_PORT, Env:LOCAL_ACCEPTANCE_WEBSITE_PASSWORD -ErrorAction SilentlyContinue
  $testPassword = $null; $secure = $null
}
