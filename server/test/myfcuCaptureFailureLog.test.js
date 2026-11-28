import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureFailureSummary} from '../src/services/localMyFcuPreview.js';

test('擷取失敗摘要只含代碼與筆數，不含課名或成績', () => {
  const report={status:'INCOMPLETE',reason:'CATEGORY_INCOMPLETE',historyReached:true,blockedRequests:0,
    stages:[{name:'tabs',status:'READY'},{name:'initial_data',status:'READY'},{name:'extracting',status:'STARTED'},{name:'extracting',status:'INCOMPLETE'}],
    categories:{categories:[{category:'#/courseSelPno',status:'incomplete',reason:'CATEGORY_INCOMPLETE',rowReviewOnly:false,rawRows:5,invalidRows:1,unresolvedReasons:{semester_unrecognized:1},unrecognizedSemesters:['寒'],courseName:'虛構課名',score:99}]}};
  const summary=captureFailureSummary(report,false);
  assert.equal(summary.reason,'CATEGORY_INCOMPLETE');
  assert.deepEqual(summary.lastStages,['tabs:READY','initial_data:READY','extracting:STARTED','extracting:INCOMPLETE']);
  assert.deepEqual(summary.categories[0],{category:'#/courseSelPno',status:'incomplete',reason:'CATEGORY_INCOMPLETE',rowReviewOnly:false,rawRows:5,invalidRows:1,unresolvedReasons:{semester_unrecognized:1},unrecognizedSemesters:['寒']});
  const text=JSON.stringify(summary);
  assert.ok(!text.includes('虛構課名') && !text.includes('99'));
});

test('沒有報告內容時摘要仍可輸出', () => {
  assert.deepEqual(captureFailureSummary(undefined,false).categories,[]);
});
