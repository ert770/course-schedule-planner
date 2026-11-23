param([switch]$ReactE2E, [switch]$LocalE2E)
# Disposable, isolated local acceptance; generates synthetic credentials in memory.
$ErrorActionPreference = 'Stop'
$name = 'codex-history-' + [Guid]::NewGuid().ToString('N').Substring(0,12)
if ($name -notmatch '^codex-history-[a-f0-9]{12}$') { throw 'Invalid container name' }
$created = $false
$env:MYSQL_ROOT_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:MYSQL_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:MYSQL_USER = 'history_test'
$env:MYSQL_DATABASE = 'codex_bootstrap'
try {
  $publish=if($ReactE2E -or $LocalE2E){'127.0.0.1::3306'}else{'127.0.0.1:33160:3306'}
  docker run --detach --rm --name $name --publish $publish --env MYSQL_ROOT_PASSWORD --env MYSQL_PASSWORD --env MYSQL_USER --env MYSQL_DATABASE mysql:8.4 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_CONTAINER_START_FAILED' }
  $created = $true
  $mapping=(docker port $name 3306/tcp | Select-Object -First 1)
  if($mapping -notmatch '^127\.0\.0\.1:([0-9]{4,5})$'){throw 'ISOLATED_PORT_INVALID'}
  $env:ISOLATED_HISTORY_MYSQL_PORT=$Matches[1]
  $env:MYSQL_PWD = $env:MYSQL_ROOT_PASSWORD
  $ready = $false
  for ($i=0; $i -lt 45; $i++) {
    docker exec --env MYSQL_PWD $name mysql -uroot --execute 'SELECT 1' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'ISOLATED_MYSQL_NOT_READY' }
  docker exec --env MYSQL_PWD $name mysql -uroot --execute "GRANT ALL PRIVILEGES ON *.* TO 'history_test'@'%';" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_USER_SETUP_FAILED' }
  $env:ISOLATED_MYSQL_USER = 'history_test'
  $env:ISOLATED_MYSQL_TEST_PASSWORD = $env:MYSQL_PASSWORD
  if ($LocalE2E) { $env:LOCAL_MYFCU_SYNTHETIC_E2E = 'true' }
  if ($ReactE2E -or $LocalE2E) { node (Join-Path $PSScriptRoot 'reactMysqlHistoryE2E.mjs') --execute } else { node (Join-Path $PSScriptRoot 'mysqlHistoryIsolated.mjs') --execute --synthetic-password-env }
  if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_ACCEPTANCE_FAILED' }
} finally {
  if ($created) { docker stop $name 2>$null | Out-Null }
  Remove-Item Env:MYSQL_ROOT_PASSWORD, Env:MYSQL_PASSWORD, Env:MYSQL_USER, Env:MYSQL_DATABASE, Env:MYSQL_PWD, Env:ISOLATED_MYSQL_USER, Env:ISOLATED_MYSQL_TEST_PASSWORD, Env:LOCAL_MYFCU_SYNTHETIC_E2E, Env:ISOLATED_HISTORY_MYSQL_PORT -ErrorAction SilentlyContinue
}
