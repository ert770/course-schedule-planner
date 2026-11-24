// Isolated fixture store: imported only by explicitly enabled local test mode.
import { createCourseHistoryImporter } from '../../src/services/courseHistoryImportService.js';
const rows=new Map();let queue=Promise.resolve();
const owners=new Map([[1,'AC-FIXTURE-A'],[2,'AC-FIXTURE-B']]);
const transaction=fn=>{const operation=queue.then(async()=>{const staged=new Map([...rows].map(([id,list])=>[id,[...list]]));
  const connection={execute:async(sql,params)=>{
    if(sql.startsWith('SELECT user_id')) {const id=params[0];return [owners.has(id)?[{user_id:id,student_id:owners.get(id)}]:[]];}
    if(sql.startsWith('SELECT catalog'))return [staged.get(params[0])??[]];
    if(sql.startsWith('INSERT')){for(let i=0,step=sql.includes('source_credit_record')?14:13;i<params.length;i+=step){const id=params[i],list=staged.get(id)??[];list.push({catalog_course_code:params[i+1],academic_year:params[i+2],semester:params[i+3],course_name:params[i+4],score:params[i+5],letter_grade:params[i+6],credits:params[i+7],passed:params[i+8],requirement_type:params[i+9],general_education_category:params[i+10],graduation_category:params[i+11],source_credit_record:sql.includes('source_credit_record')?params[i+13]:null});staged.set(id,list);}return [{}];}
    throw new Error('unsupported fixture query');}};
  const result=await fn(connection);rows.clear();for(const [id,list] of staged)rows.set(id,list);return result;});queue=operation.catch(()=>{});return operation;};
export const fixtureImporter=createCourseHistoryImporter(transaction);
