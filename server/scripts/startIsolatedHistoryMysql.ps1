# Run only after Docker Desktop is installed. Creates a disposable local-only test server.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '請先安裝並啟動 Docker Desktop。' }
$secure = Read-Host '請輸入本次專用測試帳號密碼（僅供可拋棄的測試容器）' -AsSecureString
$env:MYSQL_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
if ([string]::IsNullOrWhiteSpace($env:MYSQL_PASSWORD)) { throw '測試密碼不可為空。' }
$env:MYSQL_ROOT_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:MYSQL_DATABASE = 'codex_bootstrap'
$env:MYSQL_USER = 'history_test'
$created = $false
try {
  docker run --detach --rm --name codex-history-mysql --publish 127.0.0.1:33160:3306 --env MYSQL_ROOT_PASSWORD --env MYSQL_DATABASE --env MYSQL_USER --env MYSQL_PASSWORD mysql:8.4 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '無法建立隔離容器；請確認 Docker 已啟動且名稱與連接埠未被使用。' }
  $created = $true
  $env:MYSQL_PWD = $env:MYSQL_ROOT_PASSWORD
  $ready = $false
  for ($i=0; $i -lt 90; $i++) {
    docker exec --env MYSQL_PWD codex-history-mysql mysql -uroot --execute 'SELECT 1' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw '測試容器啟動逾時；請檢查 Docker 狀態。' }
  # The account has database-creation privileges only on this disposable server.
  docker exec --env MYSQL_PWD codex-history-mysql mysql -uroot --execute "GRANT ALL PRIVILEGES ON *.* TO 'history_test'@'%';" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '無法設定測試帳號權限。' }
  Write-Host '隔離 MySQL 已啟動於 127.0.0.1:33160；測試帳號為 history_test。完成後執行 docker stop codex-history-mysql。'
} catch {
  if ($created) { docker stop codex-history-mysql 2>$null | Out-Null }
  throw
} finally {
  Remove-Item Env:MYSQL_ROOT_PASSWORD, Env:MYSQL_PASSWORD, Env:MYSQL_DATABASE, Env:MYSQL_USER, Env:MYSQL_PWD -ErrorAction SilentlyContinue
}
