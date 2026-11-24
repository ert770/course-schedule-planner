param([switch]$History015)
# Fresh MySQL without networking, host ports or persistent volumes.
$ErrorActionPreference='Stop'
$name='codex-013-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$env:MYSQL_ROOT_PASSWORD=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$testPassword=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:MYSQL_PASSWORD=$testPassword;$env:MYSQL_USER='history_test';$env:MYSQL_DATABASE='codex_history_test'
$created=$false
try {
 docker run --detach --rm --network none --name $name --env MYSQL_ROOT_PASSWORD --env MYSQL_PASSWORD --env MYSQL_USER --env MYSQL_DATABASE mysql:8.4 | Out-Null
 if($LASTEXITCODE -ne 0){throw 'CONTAINER_START_FAILED'}
 $created=$true;$env:MYSQL_PWD=$testPassword;$ready=$false
 for($i=0;$i -lt 60;$i++){docker exec --env MYSQL_PWD $name mysql -uhistory_test -D codex_history_test --execute 'SELECT 1' 2>$null | Out-Null;if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Seconds 1}
 if(-not $ready){throw 'MYSQL_NOT_READY'}
 $env:MYSQL_PWD=$testPassword;$env:ISOLATED_013_CONTAINER=$name
 if($History015){node (Join-Path $PSScriptRoot 'mysql015ContainerAcceptance.mjs')}else{node (Join-Path $PSScriptRoot 'mysql013ContainerAcceptance.mjs')}
 if($LASTEXITCODE -ne 0){throw 'TEST_FAILED'}
} finally {
 if($created){docker stop $name 2>$null | Out-Null}
 Remove-Item Env:MYSQL_ROOT_PASSWORD,Env:MYSQL_PASSWORD,Env:MYSQL_USER,Env:MYSQL_DATABASE,Env:MYSQL_PWD,Env:ISOLATED_013_CONTAINER -ErrorAction SilentlyContinue
 $testPassword=$null
}
