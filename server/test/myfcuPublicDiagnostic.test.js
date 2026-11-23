import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedRequest, summarizeHeaders } from '../scripts/diagnoseMyFcuPublic.mjs';
import { MYFCU_START_URL } from '../src/services/myfcuCompatibility.js';
test('diagnostic blocks protected paths, external origins, navigation and form submission', () => {
  assert.equal(allowedRequest(MYFCU_START_URL,true),true);
  assert.equal(allowedRequest('https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx',true),false);
  assert.equal(allowedRequest('https://evil.example/',false),false);
  assert.equal(allowedRequest('https://myfcu.fcu.edu.tw/other',true),false);
  assert.equal(allowedRequest(MYFCU_START_URL,true,'POST'),false);
});
test('header summary never exposes values, nonces, cookies or tokens', () => {
  const out=summarizeHeaders({'content-security-policy':"default-src 'self'; script-src 'nonce-secret'",'set-cookie':'secret','x-frame-options':'DENY'});
  assert.deepEqual(out['content-security-policy-directives'],['default-src','script-src']);
  assert.equal(out['x-frame-options'],true);assert.equal(JSON.stringify(out).includes('secret'),false);
});


test('history POST endpoint diagnostics redact dynamic path segments and omit URL parameters', async () => {
 const {describeHistoryEndpoint}=await import('../scripts/diagnoseMyFcuIntegrated.mjs');
 const context={sourceUrl:'https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx#/courseXd',mainFrame:true,navigation:false,resourceType:'xhr'};
 assert.deepEqual(describeHistoryEndpoint('https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx/GetCourseData?secret=hidden#x',context),{pathname:'/main/S3603/S360380_pmust.aspx/GetCourseData',classification:'STATIC_SHAPED_CANDIDATE_NOT_VERIFIED',requiresHumanReview:true});
 const x=describeHistoryEndpoint('https://myfcu.fcu.edu.tw/main/S3603/D8800001/token12345678?private=1',context);
 assert.equal(x.pathname,'/main/S3603/{redacted}/{redacted}');assert.equal(x.classification,'TEMPLATE_REQUIRES_REVIEW');
 assert.equal(describeHistoryEndpoint('https://evil.example/main/S3603/GetCourseData',context),null);
 assert.equal(describeHistoryEndpoint('https://myfcu.fcu.edu.tw/main/S3603/GetCourseData',{...context,mainFrame:false}),null);
});
