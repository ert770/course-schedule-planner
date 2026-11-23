import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { courseHistoryImportAPI, profileAPI } from '../services/api';
import { confirmCreditRecordScores, confirmSourceClassification, confirmSameScoreOutcome, confirmSourceOutcome } from '../utils/courseHistoryBatchConfirm';
import { summarizeHistoryReview } from '../utils/courseHistoryReview';

const statusText={new:'可新增',duplicate_existing:'已存在',duplicate_input:'檔案內重複',invalid:'資料待修正',conflict_input:'檔案內衝突',conflict_existing:'與既有資料衝突'};
const categories=[['required','必修'],['elective','選修'],['general','通識'],['external','系外'],['unspecified','未分類'],['nonGraduation','不計畢業']];
function prepareRows(list) { return list.map(r=>({...r,score:r.score??'',passed:typeof r.passed==='boolean'?String(r.passed):'',requirementType:r.requirementType??'',graduationCategory:r.graduationCategory??''})); }
function needsReview(r) {return !r.courseCode || !r.courseName || !Number.isInteger(r.academicYear) || !Number.isInteger(r.semester) || typeof r.credits!=='number' || !['true','false'].includes(r.passed) || !r.requirementType || !r.graduationCategory || Boolean(r.conflictingRows?.length);}
export default function CourseHistoryImportPage(){
  const navigate=useNavigate(), location=useLocation();
  const mockHistory=import.meta.env.DEV?location.state?.mockHistory:null;
  const [rows,setRows]=useState(()=>mockHistory?.allCategoriesComplete ? prepareRows([...(mockHistory.records??[]),...(mockHistory.pendingRecords??[])]) : []);
  const [showAll,setShowAll]=useState(false);const [consent,setConsent]=useState(false);const [identityConfirmed,setIdentity]=useState(false);const [fieldsConfirmed,setFields]=useState(false);
  const [batchSource,setBatchSource]=useState('');const [batchRequirement,setBatchRequirement]=useState('');const [batchCategory,setBatchCategory]=useState('');const [batchScore,setBatchScore]=useState('');const [batchOutcome,setBatchOutcome]=useState('');
  const [plan,setPlan]=useState(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const update=(i,key,value)=>{setPlan(null);setFields(false);setRows(old=>old.map((row,n)=>n===i?{...row,[key]:value}:row));};
  const load=async e=>{setMessage('');setPlan(null);setFields(false);const file=e.target.files?.[0];if(!file)return;try{
    if(file.size>2_000_000)throw new Error('檔案過大');const parsed=JSON.parse(await file.text());
    const list=Array.isArray(parsed)?parsed:[...(parsed.records??[]),...(parsed.pendingRecords??[])];
    if(!Array.isArray(list)||!list.length||list.length>1000)throw new Error('檔案中沒有可處理的紀錄或筆數過多');
    setRows(prepareRows(list));
  }catch(error){setRows([]);setMessage(error.message||'JSON 格式錯誤');}e.target.value='';};
  const sources=[...new Set(rows.flatMap(row=>Array.isArray(row.sourceCategories)?row.sourceCategories:[]).filter(x=>typeof x==='string' && x))];
  const scores=[...new Set(rows.filter(row=>row.score!=='' && row.score!=null).map(row=>String(row.score)))].sort((a,b)=>Number(a)-Number(b));
  const batch=(message,transform)=>{if(!window.confirm(message))return;setRows(old=>transform(old));setPlan(null);setFields(false);};
  const reviewSummary=summarizeHistoryReview(rows,mockHistory?.summary??{},plan);
  const visibleRows=rows.map((row,index)=>({row,index})).filter(({row,index})=>showAll || needsReview(row) || (plan?.items?.[index] && ['invalid','conflict_input','conflict_existing'].includes(plan.items[index].status)));
  const payload=()=>({consent,identityConfirmed,fieldsConfirmed,localSourceAttested:identityConfirmed,records:rows.map(r=>({...r,score:r.score===''?null:Number(r.score),passed:r.passed==='true'?true:r.passed==='false'?false:null}))});
  const perform=async action=>{setBusy(true);setMessage('');try{const result=await courseHistoryImportAPI[action](payload());if(action==='preview')setPlan(result.plan);else {setRows([]);setPlan(null);try{if(!result.fixture)await profileAPI.get();}catch{setMessage('匯入成功，但個人資料重新載入失敗，請返回首頁重新整理。');return;}navigate('/',{replace:true,state:{courseHistoryImported:result.inserted}});}}catch(error){setMessage(error.message||'操作失敗');}finally{setBusy(false);}};
  return <main style={{maxWidth:1200,margin:'2rem auto',padding:'0 1rem'}}><Link to="/">← 返回首頁</Link><h1>匯入歷年修課紀錄</h1>
    <p>資料用於修課紀錄、推薦與畢業進度。此為學生自行聲明來源，並非官方身分驗證；請確認資料屬於本人。學生聲明會隨匯入記錄保存。</p>
    <label><input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);setPlan(null);}}/> 我同意使用與儲存修課資料</label>{' '}
    <label><input type="checkbox" checked={identityConfirmed} onChange={e=>{setIdentity(e.target.checked);setPlan(null);}}/> 我確認檔案屬於本人（身分未經系統驗證）</label>
    <p><input type="file" accept=".json,application/json" disabled={!consent||!identityConfirmed} onChange={load}/></p>
    {rows.length>0&&<><section aria-label="擷取與匯入摘要"><h2>資料摘要</h2><p>擷取紀錄 {reviewSummary.extracted} 筆；格式完整 {reviewSummary.valid} 筆；待確認 {reviewSummary.unresolved} 筆；可新增 {reviewSummary.importable ?? '尚未比對'} 筆；衝突 {reviewSummary.conflicts} 筆。</p>{reviewSummary.rawRows!==null&&<p>來源列 {reviewSummary.rawRows} 筆；重複 {reviewSummary.duplicates ?? '未知'} 筆；排除 {reviewSummary.excluded ?? '未知'} 筆。</p>}<p>格式完整不代表已完成、已取得學分或可匯入；未確認的成績、通過狀態和分類不會自行推定。</p></section><section aria-label="批次確認"><h2>批次確認</h2>
      <p>只有核對官方資料後才套用；不會覆蓋已有值或處理衝突紀錄。</p>
      <button type="button" onClick={()=>batch('你已確認所有可用數值的「取得學分記錄」均為正式成績？特殊值會保留待確認。',old=>confirmCreditRecordScores(old,true))}>確認並帶入數值成績</button>
      <p><label>來源分類 <select value={batchSource} onChange={e=>setBatchSource(e.target.value)}><option value="">請選擇</option>{sources.map(x=><option key={x}>{x}</option>)}</select></label>{' '}
      <label>修習別 <select value={batchRequirement} onChange={e=>setBatchRequirement(e.target.value)}><option value="">請選擇</option><option>必修</option><option>選修</option></select></label>{' '}
      <label>畢業分類 <select value={batchCategory} onChange={e=>setBatchCategory(e.target.value)}><option value="">請選擇</option>{categories.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>{' '}
      <button type="button" disabled={!batchSource||!batchRequirement||!batchCategory} onClick={()=>batch('你已確認此單一來源分類可使用所選修習別及畢業分類？多來源或不一致的紀錄會保留待確認。',old=>confirmSourceClassification(old,batchSource,batchRequirement,batchCategory,true))}>確認並套用分類</button></p>
      <p><label>相同成績 <select value={batchScore} onChange={e=>setBatchScore(e.target.value)}><option value="">請選擇</option>{scores.map(x=><option key={x} value={x}>{x}</option>)}</select></label>{' '}
      <label>確認狀態 <select value={batchOutcome} onChange={e=>setBatchOutcome(e.target.value)}><option value="">請選擇</option><option value="true">通過</option><option value="false">未通過</option></select></label>{' '}
      <button type="button" disabled={batchScore===''||!batchOutcome} onClick={()=>batch('你已核對所有此成績且尚未設定狀態的紀錄，確定它們都符合所選結果？系統不依分數自動推定。',old=>confirmSameScoreOutcome(old,batchScore,batchOutcome,true))}>確認並套用狀態</button></p>
      <p><button type="button" disabled={!batchSource||!batchOutcome} onClick={()=>batch('你聲明已逐筆核對此來源分類中尚未設定結果的紀錄，且它們都符合所選通過狀態？多來源及衝突紀錄會保留待確認。',old=>confirmSourceOutcome(old,batchSource,batchOutcome,true))}>本人聲明並套用來源分類的通過狀態</button></p>
    </section><p><button type="button" onClick={()=>batch('只保留欄位已確認且沒有來源衝突的紀錄？未確認紀錄不會匯入。',old=>old.filter(row=>!needsReview(row)))}>僅保留已確認資料</button></p><p>共 {rows.length} 筆；{rows.filter(needsReview).length} 筆需要確認。<button type="button" onClick={()=>setShowAll(value=>!value)}>{showAll?'只顯示待確認':'檢視全部紀錄'}</button></p><p>成績可留空；請由本人核對並聲明是否通過及課程分類。有衝突的紀錄請移除或先處理。未確認的值不會自行推定。</p><div style={{overflowX:'auto'}}><table><thead><tr><th>課號／課名</th><th>學年／學期</th><th>學分</th><th>來源分類</th><th>原始記錄</th><th>正式成績</th><th>通過</th><th>修習別</th><th>畢業分類</th><th>狀態</th><th>處理</th></tr></thead><tbody>{visibleRows.map(({row:r,index:i})=><tr key={i}><td>{r.courseCode} {r.courseName}</td><td>{r.academicYear}／{r.semester}</td><td>{r.credits}</td><td>{r.sourceCategories?.join('、')||'—'}</td><td>{r.sourceCreditRecord??'—'}</td><td><input aria-label={`第${i+1}筆成績`} type="number" min="0" max="100" value={r.score} onChange={e=>update(i,'score',e.target.value)} style={{width:75}}/></td><td><select value={r.passed} onChange={e=>update(i,'passed',e.target.value)}><option value="">請確認</option><option value="true">通過</option><option value="false">未通過</option></select></td><td><select value={r.requirementType} onChange={e=>update(i,'requirementType',e.target.value)}><option value="">請確認</option><option>必修</option><option>選修</option></select></td><td><select value={r.graduationCategory} onChange={e=>update(i,'graduationCategory',e.target.value)}><option value="">請確認</option>{categories.map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></td><td>{r.conflictingRows?.length?'來源衝突':plan?.items?.[i]?(statusText[plan.items[i].status]??'待確認')+(plan.items[i].errors?.length?'：'+plan.items[i].errors.join('、'):''):'未預覽'}</td><td><button type="button" onClick={()=>{setRows(old=>old.filter((_,n)=>n!==i));setPlan(null);setFields(false);}}>移除此筆</button></td></tr>)}</tbody></table></div>
    <p><label><input type="checkbox" checked={fieldsConfirmed} onChange={e=>{setFields(e.target.checked);setPlan(null);}}/> 我聲明已核對通過狀態與分類；未確認的成績保留空白</label></p>
    <button type="button" disabled={busy||!consent||!identityConfirmed||!fieldsConfirmed} onClick={()=>perform('preview')}>比對並預覽</button>{' '}
    <button type="button" disabled={busy||!plan||plan.items.some(x=>['invalid','conflict_input','conflict_existing'].includes(x.status))} onClick={()=>perform('commit')}>確認匯入</button></>}
    {message&&<p role="alert">{message}</p>}
  </main>;
}
