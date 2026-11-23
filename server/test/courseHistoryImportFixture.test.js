import {test} from 'node:test';
import assert from 'node:assert/strict';
import router,{configureHistoryImport} from '../src/routes/courseHistoryImport.js';
const keys=['NODE_ENV','CONTROLLED_BROWSER_MOCK','CONTROLLED_BROWSER_REAL_TEST','CONTROLLED_BROWSER_PERSONAL_TEST','COURSE_HISTORY_IMPORT_FIXTURE','DB_HOST','DB_USER','DB_NAME','CLIENT_ORIGIN'];
const item={courseCode:'TEST2001',courseName:'虛構',academicYear:112,semester:1,credits:3,score:70,passed:true,requirementType:'選修',graduationCategory:'elective'};
const response=()=>({code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;},set(){return this;}});
test('isolated fixture route previews, commits, rejects spoofing and isolates two users',async()=>{
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  Object.assign(process.env,{NODE_ENV:'test',CONTROLLED_BROWSER_MOCK:'true',CONTROLLED_BROWSER_REAL_TEST:'false',CONTROLLED_BROWSER_PERSONAL_TEST:'false',COURSE_HISTORY_IMPORT_FIXTURE:'true',DB_HOST:'',DB_USER:'',DB_NAME:'',CLIENT_ORIGIN:'http://localhost:5173'});
  const req=(id,name)=>({identity:{found:true,canonicalId:name,numericId:String(id),canWriteMysqlProfile:true},socket:{remoteAddress:'127.0.0.1'},get:()=> 'http://localhost:5173',body:{consent:true,identityConfirmed:true,fieldsConfirmed:true,records:[item]}});
  const run=async(action,r)=>{let next=false;const res=response();await configureHistoryImport(r,res,()=>{next=true});if(next){const handler=router.stack.find(x=>x.route?.path==='/'+action).route.stack[0].handle;await handler(r,res);}return res;};
  const a=req(1,'AC-FIXTURE-A'),b=req(2,'AC-FIXTURE-B');
  assert.equal((await run('preview',a)).body.plan.items[0].status,'new');
  assert.equal((await run('commit',a)).body.inserted,1);
  assert.equal((await run('preview',a)).body.plan.items[0].status,'duplicate_existing');
  assert.equal((await run('preview',b)).body.plan.items[0].status,'new');
  const spoof=req(1,'AC-FIXTURE-A');spoof.body.user_id=2;assert.equal((await run('commit',spoof)).code,400);
  process.env.DB_HOST='x';process.env.DB_USER='x';process.env.DB_NAME='x';assert.equal((await run('preview',a)).code,403);
 } finally {for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});

test('production import remains locked even when the client claims identity verification',async()=>{
 const saved=Object.fromEntries([...keys,'COURSE_HISTORY_IMPORT_ENABLED'].map(k=>[k,process.env[k]]));
 try{
  Object.assign(process.env,{NODE_ENV:'production',CONTROLLED_BROWSER_MOCK:'false',CONTROLLED_BROWSER_REAL_TEST:'false',CONTROLLED_BROWSER_PERSONAL_TEST:'false',COURSE_HISTORY_IMPORT_FIXTURE:'false',COURSE_HISTORY_IMPORT_ENABLED:'true'});
  const req={identity:{found:true,canonicalId:'SYNTHETIC',numericId:'5'},socket:{remoteAddress:'127.0.0.1'},get:()=> 'http://localhost:5173',body:{identityConfirmed:true,myfcuIdentityVerified:true}};
  const res=response();let called=false;await configureHistoryImport(req,res,()=>{called=true});assert.equal(called,false);assert.equal(res.code,503);
 }finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
