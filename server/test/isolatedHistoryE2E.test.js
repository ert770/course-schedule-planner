import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isIsolatedHistoryMysqlE2E,isSyntheticHistoryIdentity,isLocalSelfAttestedHistory} from '../src/services/isolatedHistoryE2E.js';
import {verifyIsolatedHistoryProof} from '../src/services/controlledBrowserService.js';
const base={NODE_ENV:'test',ISOLATED_HISTORY_MYSQL_E2E:'true',CONTROLLED_BROWSER_MOCK:'true',DB_HOST:'127.0.0.1',DB_PORT:'33160',DB_USER:'history_test',DB_NAME:'codex_history_0123456789abcdef',DB_SSL_CA_PATH:''};
test('isolated MySQL mode fails closed for production and nonlocal or non-disposable databases',()=>{
 assert.equal(isIsolatedHistoryMysqlE2E(base),true);
 for(const changes of [{NODE_ENV:'production'},{DB_HOST:'example.com'},{DB_HOST:'localhost'},{DB_PORT:'3306'},{DB_USER:'root'},{DB_NAME:'defaultdb'},{DB_SSL_CA_PATH:'ca.pem'},{CONTROLLED_BROWSER_MOCK:'false'},{CONTROLLED_BROWSER_REAL_TEST:'true'},{CONTROLLED_BROWSER_PERSONAL_TEST:'true'}])assert.equal(isIsolatedHistoryMysqlE2E({...base,...changes}),false);
});
test('test identity is limited to two server-resolved synthetic account mappings',()=>{
 assert.equal(isSyntheticHistoryIdentity({found:true,source:'mysql',canonicalId:'AC-FIXTURE-A',numericId:'1'}),true);
 for(const value of [{found:true,source:'mysql',canonicalId:'AC-FIXTURE-A',numericId:'2'},{found:true,source:'legacy',canonicalId:'AC-FIXTURE-A',numericId:'1'},{found:true,source:'mysql',canonicalId:'REAL',numericId:'1'}])assert.equal(isSyntheticHistoryIdentity(value),false);
 assert.equal(verifyIsolatedHistoryProof({found:true,source:'mysql',canonicalId:'AC-FIXTURE-A',numericId:'1'},'not-a-session',[]),false);
});
test('local acceptance temporary port remains explicitly isolated and disabled in production',()=>{
 const env={NODE_ENV:'development',LOCAL_MYFCU_PREVIEW:'true',LOCAL_MYFCU_ACCEPTANCE:'true',LOCAL_MYFCU_ACCEPTANCE_PORT:'45321',LOCAL_MYFCU_SELF_ATTESTED_IMPORT:'true',LOCAL_MYFCU_ALLOW_LOCAL_DB:'true',CONTROLLED_BROWSER_MOCK:'false',DB_HOST:'127.0.0.1',DB_PORT:'45321',DB_USER:'history_test',DB_NAME:'codex_history_0123456789abcdef'};
 assert.equal(isLocalSelfAttestedHistory(env),process.platform==='win32');
 for(const changed of [{NODE_ENV:'production'},{DB_HOST:'example.com'},{DB_PORT:'45322'},{LOCAL_MYFCU_ACCEPTANCE:'false'},{DB_USER:'root'},{DB_NAME:'defaultdb'},{DB_SSL_CA_PATH:'ca.pem'}])assert.equal(isLocalSelfAttestedHistory({...env,...changed}),false);
});
