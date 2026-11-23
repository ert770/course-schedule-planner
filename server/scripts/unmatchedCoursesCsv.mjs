import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const escapeCell=value=>{let text=String(value??'');if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
export function formatUnmatchedCsv(rows){
 const header=['課程名稱','修讀班級','學年','學期','來源課號','未匹配原因'];
 const lines=rows.map(row=>{const raw=typeof row.source_payload==='string'?JSON.parse(row.source_payload):row.source_payload??{};return [raw.courseName,raw.sourceClassName,row.academic_year,row.semester,raw.sourceCourseCode??row.catalog_course_code,row.reason].map(escapeCell).join(',');});
 return '\ufeff'+[header.map(escapeCell).join(','),...lines].join('\r\n')+'\r\n';
}
export async function writeUnmatchedCsv(directory,rows){
 await mkdir(directory,{recursive:true});const csv=formatUnmatchedCsv(rows);
 for(let i=0;i<1000;i++){const file=path.join(directory,i===0?'unmatched_courses.csv':`unmatched_courses_${i}.csv`);try{await writeFile(file,csv,{encoding:'utf8',flag:'wx'});return file;}catch(error){if(error.code!=='EEXIST')throw error;}}
 throw Error('REPORT_NAME_EXHAUSTED');
}
