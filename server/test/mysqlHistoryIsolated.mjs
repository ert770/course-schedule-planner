// Explicit local-only acceptance; creates and drops only a freshly named test database.
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stdin,stdout } from 'node:process';
import assert from 'node:assert/strict';
import { createCourseHistoryImporter } from '../src/services/courseHistoryImportService.js';
import { mapCourseHistoryRow } from '../src/db/database.js';
import { getPassedCourseCodes,getTotalEarnedCredits } from '../src/data/courseHistory.js';

async function promptSecret(){
 if(!stdin.isTTY)throw Error('INTERACTIVE_INPUT_REQUIRED');
 stdout.write('本機隔離 MySQL 密碼（不顯示）：');stdin.setRawMode(true);stdin.resume();
 return new Promise((resolve,reject)=>{let value='';const onData=buf=>{for(const c of buf.toString('utf8')){if(c==='\u0003'){cleanup();reject(Error('CANCELLED'));return;}if(c==='\r'||c==='\n'){cleanup();stdout.write('\n');resolve(value);return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else value+=c;}};function cleanup(){stdin.off('data',onData);stdin.setRawMode(false);stdin.pause();}stdin.on('data',onData);});
}
async function main(){
 if(!process.argv.includes('--execute')){stdout.write('BLOCKED：此腳本只連接 127.0.0.1:33160，須以 --execute 明確啟動全新隔離測試庫。\n');return;}
 const user=process.env.ISOLATED_MYSQL_USER;
 if(!user || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(user) || /^(?:root|admin|administrator)$/i.test(user))throw Error('DEDICATED_TEST_USER_REQUIRED');
 const password=process.argv.includes('--synthetic-password-env') ? process.env.ISOLATED_MYSQL_TEST_PASSWORD : await promptSecret();
 if(typeof password!=='string' || !password) throw Error('TEST_PASSWORD_REQUIRED');
 delete process.env.ISOLATED_MYSQL_TEST_PASSWORD;let connection,created=false;const db='codex_history_'+crypto.randomBytes(8).toString('hex');
 if(!/^codex_history_[a-f0-9]{16}$/.test(db))throw Error('INVALID_DATABASE');
 try{
  connection=await mysql.createConnection({host:'127.0.0.1',port:33160,user,password,connectTimeout:5000,multipleStatements:false});
  await connection.query('CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4');created=true;
  await connection.changeUser({database:db});
  await connection.query('CREATE TABLE User_Profiles (user_id INT PRIMARY KEY, student_id VARCHAR(32) UNIQUE) ENGINE=InnoDB');
  let schema=await readFile(new URL('../migrations/004_course-history-v1.up.sql',import.meta.url),'utf8');
  schema=schema.replace('`User_Course_History_v1_new`','`User_Course_History`');await connection.query(schema);
  const source=await readFile(new URL('../migrations/011_history-source-credit.up.sql',import.meta.url),'utf8');await connection.query(source);
  await connection.execute('INSERT INTO User_Profiles (user_id,student_id) VALUES (?,?),(?,?)',[1,'SYNTHETIC_A',2,'SYNTHETIC_B']);
  const transaction=async fn=>{await connection.beginTransaction();try{const value=await fn(connection);await connection.commit();return value;}catch(e){await connection.rollback();throw e;}};
  const api=createCourseHistoryImporter(transaction),who=id=>({found:true,source:'mysql',canonicalId:id===1?'SYNTHETIC_A':'SYNTHETIC_B',numericId:String(id),canWriteMysqlProfile:true});
  const body=records=>({consent:true,identityConfirmed:true,fieldsConfirmed:true,records});
  const row={courseCode:'TEST1001',courseName:'虛構',academicYear:112,semester:1,credits:3,score:null,passed:true,requirementType:'必修',graduationCategory:'required',sourceCreditRecord:'X'};
  assert.equal((await api.commit(body([row]),who(1))).inserted,1);
  assert.equal((await api.commit(body([row]),who(1))).inserted,0);
  assert.equal((await api.commit(body([{...row,semester:2,passed:false}]),who(1))).inserted,1);
  await assert.rejects(api.commit(body([{...row,credits:4}]),who(1)));
  assert.equal((await api.commit(body([row]),who(2))).inserted,1);
  await assert.rejects(transaction(async c=>{await c.execute('INSERT INTO User_Profiles(user_id,student_id) VALUES (?,?)',[3,'SYNTHETIC_C']);throw Error('ROLLBACK_TEST');}));
  const [rolled]=await connection.execute('SELECT COUNT(*) AS n FROM User_Profiles WHERE user_id=?',[3]);assert.equal(rolled[0].n,0);
  const [rows]=await connection.execute('SELECT history_id,academic_year,semester,catalog_course_code,course_name,score,letter_grade,credits,passed,requirement_type,general_education_category,graduation_category,source_credit_record FROM User_Course_History WHERE user_id=? ORDER BY academic_year,semester',[1]);
  assert.equal(rows.length,2);assert.equal(rows[0].score,null);assert.equal(rows[0].source_credit_record,'X');
  const history=rows.map(mapCourseHistoryRow);assert.deepEqual(getPassedCourseCodes(history),[]);assert.equal(getTotalEarnedCredits(history),0);
  const [other]=await connection.execute('SELECT COUNT(*) AS n FROM User_Course_History WHERE user_id=?',[2]);assert.equal(other[0].n,1);
  stdout.write('PASS：隔離 MySQL schema 004/011、寫入、重複、重修、衝突、回滾、隔離、NULL 成績與已修／畢業學分核心。\n');
 }catch{stdout.write('FAIL：隔離 MySQL 測試未完成；不輸出連線資訊或資料內容。\n');process.exitCode=1;}
 finally{if(connection){if(created)try{await connection.query('DROP DATABASE `'+db+'`');}catch{stdout.write('警告：測試資料庫未能確認清除，請檢查本機隔離伺服器。\n');process.exitCode=1;}await connection.end().catch(()=>{});}}
}
await main().catch(()=>{stdout.write('BLOCKED：需設定專用測試帳號並使用本機互動式輸入。\n');process.exitCode=1;});
