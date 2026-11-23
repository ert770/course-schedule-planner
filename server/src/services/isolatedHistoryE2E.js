// Strictly scoped to disposable localhost E2E databases and synthetic accounts.
export function isIsolatedHistoryMysqlE2E(env=process.env) {
 const port=String(env.DB_PORT??'');const disposablePort=port==='33160'||(/^[0-9]{4,5}$/.test(port)&&Number(port)>=1024&&Number(port)<=65535&&port===env.ISOLATED_HISTORY_MYSQL_PORT);
 return env.NODE_ENV==='test' && env.ISOLATED_HISTORY_MYSQL_E2E==='true' && env.CONTROLLED_BROWSER_MOCK==='true' && env.CONTROLLED_BROWSER_REAL_TEST!=='true' && env.CONTROLLED_BROWSER_PERSONAL_TEST!=='true' && env.DB_HOST==='127.0.0.1' && disposablePort && env.DB_USER==='history_test' && /^codex_history_[a-f0-9]{16}$/.test(env.DB_NAME??'') && !env.DB_SSL_CA_PATH;
}
export function isSyntheticHistoryIdentity(identity) {
 return identity?.found===true && identity.source==='mysql' && ((identity.canonicalId==='AC-FIXTURE-A' && String(identity.numericId)==='1')||(identity.canonicalId==='AC-FIXTURE-B' && String(identity.numericId)==='2'));
}
// A separate, deliberately narrow trust level: never official identity verification.
export function isLocalSelfAttestedHistory(env=process.env) {
 const port=String(env.DB_PORT??'');const acceptancePort=env.LOCAL_MYFCU_ACCEPTANCE==='true'&&/^[0-9]{4,5}$/.test(port)&&Number(port)>=1024&&Number(port)<=65535&&port===env.LOCAL_MYFCU_ACCEPTANCE_PORT;
 return process.platform==='win32' && env.NODE_ENV!=='production' && env.LOCAL_MYFCU_PREVIEW==='true' && env.LOCAL_MYFCU_SELF_ATTESTED_IMPORT==='true' && env.LOCAL_MYFCU_ALLOW_LOCAL_DB==='true' && env.DB_HOST==='127.0.0.1' && (port==='33160'||isIsolatedHistoryMysqlE2E(env)||acceptancePort) && env.DB_USER==='history_test' && /^codex_history_[a-f0-9]{16}$/.test(env.DB_NAME??'') && !env.DB_SSL_CA_PATH && env.CONTROLLED_BROWSER_REAL_TEST!=='true' && env.CONTROLLED_BROWSER_PERSONAL_TEST!=='true' && (env.CONTROLLED_BROWSER_MOCK!=='true' || isIsolatedHistoryMysqlE2E(env));
}

// Explicit local Windows session import; never enables the isolated test identity provider.
export function isSessionHistoryImport(env=process.env) {
 return process.platform==='win32' && env.NODE_ENV==='development' && env.LOCAL_MYFCU_PREVIEW==='true' && env.MYFCU_SESSION_IMPORT==='true' && env.DB_HOST?.endsWith('.aivencloud.com') && Boolean(env.DB_SSL_CA_PATH && env.DB_USER && env.DB_NAME) && env.CONTROLLED_BROWSER_MOCK!=='true' && env.CONTROLLED_BROWSER_REAL_TEST!=='true' && env.CONTROLLED_BROWSER_PERSONAL_TEST!=='true' && env.ISOLATED_HISTORY_MYSQL_E2E!=='true' && env.LOCAL_MYFCU_SELF_ATTESTED_IMPORT!=='true' && env.LOCAL_MYFCU_SYNTHETIC_E2E!=='true';
}
