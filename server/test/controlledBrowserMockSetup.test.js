import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, 'fixtures', 'account-isolation');
const keys = ['NODE_ENV','CONTROLLED_BROWSER_MOCK','CONTROLLED_BROWSER_REAL_TEST','PRIVACY_ENFORCEMENT_ENABLED','ALLOW_LEGACY_JSON_AUTH','DATA_DIR','DB_HOST','DB_USER','DB_NAME','DB_PASSWORD','DB_SSL_CA_PATH'];
const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
function mockEnvironment() {
  process.env.NODE_ENV='test'; process.env.CONTROLLED_BROWSER_MOCK='true'; process.env.CONTROLLED_BROWSER_REAL_TEST='false'; process.env.ALLOW_LEGACY_JSON_AUTH='true'; process.env.DATA_DIR=fixtureDir;
  for (const k of ['DB_HOST','DB_USER','DB_NAME','DB_PASSWORD','DB_SSL_CA_PATH']) process.env[k]='';
}
function restore() { for (const k of keys) { if (original[k] === undefined) delete process.env[k]; else process.env[k] = original[k]; } }

test('mock bypass marker is confined to isolated fixture users without MySQL', async () => {
  mockEnvironment();
  try {
    const { isControlledBrowserMockUser } = await import('../src/routes/auth.js');
    const user = { id: 1, studentId: 'AC-FIXTURE-A' };
    const local={socket:{remoteAddress:'127.0.0.1'}};
    assert.equal(isControlledBrowserMockUser(user,local), true);
    assert.equal(isControlledBrowserMockUser({ id: 99, studentId: 'AC-FIXTURE-A' },local), false);
    assert.equal(isControlledBrowserMockUser({ id: 1, studentId: 'D8800000' },local), false);
    process.env.NODE_ENV='production'; assert.equal(isControlledBrowserMockUser(user,local), false); process.env.NODE_ENV='test';
    process.env.CONTROLLED_BROWSER_MOCK='false'; assert.equal(isControlledBrowserMockUser(user,local), false); process.env.CONTROLLED_BROWSER_MOCK='true';
    process.env.CONTROLLED_BROWSER_MOCK='false'; process.env.CONTROLLED_BROWSER_REAL_TEST='true'; process.env.PRIVACY_ENFORCEMENT_ENABLED='true';
    assert.equal(isControlledBrowserMockUser(user,local),true);
    assert.equal(isControlledBrowserMockUser(user,{socket:{remoteAddress:'192.0.2.1'}}),false);
    process.env.PRIVACY_ENFORCEMENT_ENABLED='false'; assert.equal(isControlledBrowserMockUser(user,local),false);
    process.env.PRIVACY_ENFORCEMENT_ENABLED='true'; process.env.CONTROLLED_BROWSER_MOCK='true'; assert.equal(isControlledBrowserMockUser(user,local),false);
    process.env.CONTROLLED_BROWSER_REAL_TEST='false';
    process.env.DATA_DIR=here; assert.equal(isControlledBrowserMockUser(user,local), false); process.env.DATA_DIR=fixtureDir;
    process.env.DB_HOST='mock'; process.env.DB_USER='mock'; process.env.DB_NAME='mock'; assert.equal(isControlledBrowserMockUser(user,local), false);
  } finally { restore(); }
});

test('development UI bypass requires explicit server-issued mock marker', async () => {
  const { canSkipControlledBrowserSetup } = await import('../../client/src/utils/controlledBrowserMock.js');
  assert.equal(canSkipControlledBrowserSetup({controlledBrowserMock:true}, true), true);
  assert.equal(canSkipControlledBrowserSetup({controlledBrowserMock:true}, false), false);
  assert.equal(canSkipControlledBrowserSetup({}, true), false);
  assert.equal(canSkipControlledBrowserSetup(null, true), false);
});

test('fixture login and session restore return marker without MySQL', async () => {
  mockEnvironment();
  try {
    const { default: router } = await import('../src/routes/auth.js');
    const login = router.stack.find(x => x.route?.path === '/login').route.stack.at(-1).handle;
    const me = router.stack.find(x => x.route?.path === '/me').route.stack.at(-1).handle;
    function response() { return { code:200, data:null, status(n){this.code=n;return this;}, json(v){this.data=v;return this;}, setHeader(){} }; }
    const loginResponse=response();
    await login({socket:{remoteAddress:'127.0.0.1'},body:{studentId:'AC-FIXTURE-A',password:'fixture-a-pass'}},loginResponse);
    assert.equal(loginResponse.code,200); assert.equal(loginResponse.data.user.controlledBrowserMock,true);
    const meResponse=response();
    await me({socket:{remoteAddress:'127.0.0.1'},identity:{found:true,canonicalId:'AC-FIXTURE-A',numericId:'1',source:'legacy'}},meResponse);
    assert.equal(meResponse.code,200); assert.equal(meResponse.data.controlledBrowserMock,true);
    process.env.CONTROLLED_BROWSER_MOCK='false'; process.env.CONTROLLED_BROWSER_REAL_TEST='true'; process.env.PRIVACY_ENFORCEMENT_ENABLED='true';
    const publicLogin=response();
    await login({socket:{remoteAddress:'127.0.0.1'},body:{studentId:'AC-FIXTURE-A',password:'fixture-a-pass'}},publicLogin);
    assert.equal(publicLogin.data.user.controlledBrowserMock,true);
    const remoteLogin=response();
    await login({socket:{remoteAddress:'192.0.2.1'},body:{studentId:'AC-FIXTURE-A',password:'fixture-a-pass'}},remoteLogin);
    assert.equal(remoteLogin.data.user.controlledBrowserMock,undefined);
  } finally { restore(); }
});
