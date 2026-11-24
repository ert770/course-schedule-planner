import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeHistoryReview} from '../../client/src/utils/courseHistoryReview.js';
test('55 complete-looking extracted rows stay unconfirmed until independently reviewed',()=>{
 const row={courseCode:'TEST1',courseName:'虛構',academicYear:112,semester:1,credits:3,score:'',passed:'',requirementType:'',graduationCategory:'',sourceCreditRecord:'55'};
 const s=summarizeHistoryReview(Array.from({length:55},()=>({...row})),{rawRows:61,duplicateRows:3,excludedRows:3});
 assert.deepEqual(s,{rawRows:61,duplicates:3,excluded:3,extracted:55,valid:55,unresolved:55,importable:null,conflicts:0});
});
