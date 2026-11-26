import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { controlledBrowserAPI, courseHistoryImportAPI } from '../services/api';
import { buildHistoryPreview } from '../utils/controlledBrowserPreview';
import { planHistoryByName } from '../utils/historyNameDedup';
import { useAuth } from '../contexts/useAuth';
import PreferenceJourneySteps from '../components/Layout/PreferenceJourneySteps';

export default function ControlledHistoryMockPage({ onboarding = false }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState(null);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [frame, setFrame] = useState('');
  const [result, setResult] = useState(null);
  const frameUrl = useRef('');
  const keyboardRef = useRef(null);
  const composingRef = useRef(false);
  const suppressCompositionInput = useRef(false);
  const inputQueue = useRef(Promise.resolve());
  const currentId = useRef(null);
  const handoff = useRef(false);
  const [isolatedMysqlE2E, setIsolatedMysqlE2E] = useState(false);
  const [localSelfAttested, setLocalSelfAttested] = useState(false);
  const [sessionImport, setSessionImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [systemSession, setSystemSession] = useState({ status: 'unknown', numericId: null });
  const [snapshotMeta, setSnapshotMeta] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const refreshAfterInput = useRef(() => {});
  const id = session?.id;
  const realPublic = (session?.mode ?? mode) === 'real';
  const localPreview = (session?.mode ?? mode) === 'local';
  useEffect(() => {
    let active = true;
    controlledBrowserAPI.config().then(config => {
      if (active && ['mock', 'real', 'local'].includes(config.mode)) { setMode(config.mode); setIsolatedMysqlE2E(config.isolatedMysqlE2E === true); setLocalSelfAttested(config.localSelfAttested === true); setSessionImport(config.sessionImport === true); if(config.sessionImport === true) courseHistoryImportAPI.snapshot().then(snapshot=>{if(active){setResult(snapshot.result);setSnapshotMeta(snapshot);setSystemSession({status:'valid',numericId:snapshot.numericId});setStatus('snapshot_ready');}}).catch(()=>{}); }
      else if (active) setMessage('無法確認後端測試模式。');
    }).catch(error => { if (active) setMessage(error.message || '無法確認後端測試模式。'); });
    return () => { active = false; };
  }, []);
  currentId.current = id;
  const send = useCallback(event => {
    if (!id || status !== 'login' || realPublic) return;
    inputQueue.current = inputQueue.current.catch(() => {}).then(async () => {
      if (currentId.current !== id) return;
      try { await controlledBrowserAPI.input(id, event); if (currentId.current === id) refreshAfterInput.current(); }
      catch { if (currentId.current === id) setMessage('操作失敗，請重新開啟模擬工作階段。'); }
    });
  }, [id, status, realPublic]);
  const sendText = value => {
    let part = '';
    for (const character of value.replaceAll('\u200b', '')) {
      if (part.length + character.length > 200) { send({ type:'text', text:part }); part = ''; }
      part += character;
    }
    if (part) send({ type:'text', text:part });
  };
  useEffect(() => {
    if (!id || (sessionImport && snapshotMeta)) return undefined;
    let active = true, running = false, pending = false, inputTimer;
    const clearFrame = () => {
      if (frameUrl.current) URL.revokeObjectURL(frameUrl.current);
      frameUrl.current = '';
      setFrame('');
    };
    refreshAfterInput.current = () => {
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => { if (running) pending = true; else void refresh(); }, 60);
    };
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const state = await controlledBrowserAPI.state(id);
        if (!active) return;
        setStatus(state.status);
        setSystemSession({ status: 'valid', numericId: state.systemIdentity?.numericId ?? null });
        if (state.result) setResult({ ...state.result, identityVerification: state.identityVerification });
        if (state.snapshot) setSnapshotMeta(state.snapshot);
        if (state.status !== 'login') clearFrame();
        if (state.status === 'login') {
          try {
            const next = await controlledBrowserAPI.frame(id);
            if (!active) { URL.revokeObjectURL(next); return; }
            if (frameUrl.current) URL.revokeObjectURL(frameUrl.current);
            frameUrl.current = next; setFrame(next);
          } catch { /* The page may have switched to extraction between requests. */ }
        }
      } catch (error) { if (active) { clearFrame(); setStatus('error'); setSystemSession({ status: error.status === 401 ? 'expired' : 'unknown', numericId: null }); setMessage(error.status === 401 ? '系統登入已失效；預覽僅供檢視，請重新登入並重新擷取。' : 'MyFCU 擷取工作階段已結束或無法確認；預覽僅供檢視，請重新擷取。'); } }
      finally { running = false; if (active && pending) { pending = false; void refresh(); } }
    }
    refresh();
    const timer = setInterval(refresh, 800);
    return () => { active = false; clearInterval(timer); clearTimeout(inputTimer); refreshAfterInput.current = () => {}; if (frameUrl.current) { URL.revokeObjectURL(frameUrl.current); frameUrl.current = ''; } };
  }, [id, sessionImport, snapshotMeta]);
  useEffect(() => () => {
    if (id && currentId.current === id) currentId.current = null;
    if (id && !handoff.current) controlledBrowserAPI.cancel(id).catch(() => {});
  }, [id]);
  useEffect(() => {
    if (!sessionImport || !snapshotMeta) return undefined;
    let active=true;setPreflight(null);
    courseHistoryImportAPI.snapshotPreview().then(value=>{if(active){setPreflight(value);setSystemSession({status:'valid',numericId:value.numericId});}}).catch(error=>{if(active){setPreflight(null);setSystemSession({status:error.status===401?'expired':'unknown',numericId:null});setMessage(error.message || '無法完成唯讀比對');}});
    return ()=>{active=false;};
  }, [sessionImport, snapshotMeta]);
  const start = async () => {
    setMessage(''); setResult(null); setSnapshotMeta(null); setPreflight(null); setSystemSession({ status: 'unknown', numericId: null }); setStatus('starting');
    try { const next = await controlledBrowserAPI.start(consent); setSession(next); setStatus(next.status); }
    catch (e) { setStatus('error'); setMessage(e.code ? `${e.message}（${e.code}）` : e.message); }
  };
  const cancel = async () => {
    currentId.current = null;
    handoff.current = false;
    setSession(null); setFrame(''); setStatus('idle'); setSystemSession({ status: 'unknown', numericId: null }); setResult(null);
    if (id) { try { await controlledBrowserAPI.cancel(id); } catch { /* TTL still closes the context. */ } }
  };
  const finishImport = summary => {
    handoff.current = true;
    if (onboarding) navigate('/setup', { replace: true, state: { historyImported: true } });
    else navigate('/', { replace: true, state: { historySyncSummary: summary } });
  };
  const click = e => {
    const box = e.currentTarget.getBoundingClientRect();
    // Focus synchronously in the click gesture so mobile browsers can open the keyboard.
    keyboardRef.current?.focus({ preventScroll:true });
    send({ type:'click', x:(e.clientX-box.left)*390/box.width, y:(e.clientY-box.top)*720/box.height });
  };
  const namePlan = planHistoryByName([...(result?.records ?? []), ...(result?.pendingRecords ?? [])], { reconcileSourceCodes: sessionImport });
  const previewRows = sessionImport ? namePlan.candidates : buildHistoryPreview(result);
  return <main className="history-page history-sync-page">
    {onboarding ? <PreferenceJourneySteps current={2} /> : <Link className="history-back" to="/">← 返回首頁</Link>}
    <header className="history-heading"><div><span className="history-eyebrow">MYFCU SYNC</span><h1>{localPreview ? 'MyFCU 本機修課紀錄預覽' : realPublic ? 'MyFCU 公開登入頁：唯讀測試' : mode === 'mock' ? '歷年修課紀錄匯入：本機模擬' : '受控瀏覽器：確認模式中'}</h1><p>依照以下步驟完成本次修課紀錄同步。</p></div></header>
    {onboarding && !importing && <p className="history-actions"><Link className="history-button" to="/setup" replace>略過匯入，先設定偏好</Link></p>}
    <ol className="history-steps" aria-label="同步流程"><li className={!id ? 'is-active' : 'is-done'}><span>1</span>閱讀說明</li><li className={id && !result ? 'is-active' : result ? 'is-done' : ''}><span>2</span>登入與擷取</li><li className={result ? 'is-active' : ''}><span>3</span>查看結果</li></ol>
    <section className="history-card history-sync-card"><div className="history-card-heading"><div><h2>同步說明</h2><p>開始前請先閱讀資料使用方式。</p></div></div>
    {localPreview ? <><p>將在本機開啟官方 MyFCU 視窗，請由本人自行登入。程式與本機瀏覽器在技術上可能接觸登入工作階段；不記錄帳密、Cookie 或修課資料，瀏覽器與作業系統可能產生暫存。</p><p>{sessionImport ? "匯入資料將儲存至目前登入的系統帳號；系統不核對 MyFCU 學號，請務必登入本人帳號。" : localSelfAttested ? "本機測試可由本人聲明資料來源並匯入隔離測試庫；這不是官方身分驗證。" : "僅供本機預覽；尚未核對校務身分，無法匯入。"}取消、登出或逾時會關閉工作階段。</p></> : <><p>僅供本機測試。公開頁模式只能檢視，不能操作或登入；請勿輸入真實校務帳號或密碼。受控瀏覽器由伺服器操作，伺服器有能力接觸輸入內容。</p><p>畫面及虛構修課資料僅在本次工作階段記憶體中處理，不寫入資料庫；取消、登出或五分鐘逾時後會銷毀。</p></>}
    <label className="history-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={!!id} /> <span>我已閱讀並同意本次本機測試，並確認 MyFCU 修課資料屬於本人（非官方身分驗證）。</span></label>
    {!id && <p className="history-actions"><button className="history-button history-button-primary" type="button" onClick={start} disabled={!mode || !consent || status === 'starting'}>{localPreview ? '開啟本機 MyFCU 視窗' : realPublic ? '開啟公開登入頁' : '開始本機模擬'}</button></p>}
    </section>
    {message && <p className="history-alert" role="alert">{message}</p>}
    {(id || snapshotMeta) && <p role="status">系統登入 Session：{systemSession.status === 'valid' ? `已由後端核對（user_id=${systemSession.numericId ?? '未知'}）` : systemSession.status === 'expired' ? '已失效' : '無法確認'}；MyFCU 擷取工作階段：{snapshotMeta ? '可關閉，資料已保存於後端快照' : status === 'ready' ? '有效' : status === 'error' ? '已結束或無法確認' : '處理中'}。</p>}
    {(id || (sessionImport && snapshotMeta && result)) && <><section className="history-card history-sync-card"><div className="history-card-heading"><div><h2>工作階段</h2><p>完成登入後，系統將處理修課資料。</p></div><span className="history-status">{ {starting:'啟動中',login:realPublic?'唯讀檢視中':'等待登入',extracting:'擷取中',ready:'擷取完成',incomplete:'部分未完成',error:'擷取失敗'}[status] || status }</span></div>{localPreview && status==='starting' && <p>請在已開啟的本機 Chrome 視窗自行登入 MyFCU；完成後將自動擷取並顯示預覽。</p>}<p>狀態：{ {starting:'啟動中',login:realPublic?'檢視 MyFCU 公開登入頁（操作已停用）':'操作模擬登入頁',extracting:'擷取中',ready:'擷取完成',incomplete:'部分分類未完成',error:'擷取失敗'}[status] || status }</p>
      {id && <button className="history-button history-button-secondary" type="button" onClick={cancel}>取消並關閉工作階段</button>}
      {status === 'login' && <><p>{realPublic ? '僅供檢視公開頁，無法輸入或登入。' : '點選下方模擬畫面的欄位後，可直接使用鍵盤輸入。手機請點選畫面以叫出鍵盤。'}</p>
        {frame && <img src={frame} onClick={realPublic ? undefined : click} alt={realPublic ? 'MyFCU 公開登入頁唯讀畫面' : '可點選的模擬瀏覽器畫面'} style={{display:'block', width:'100%', maxWidth:'min(100%, 720px)', height:'auto', touchAction:'manipulation', border:'1px solid #aaa'}} />}
        {!realPublic && <input ref={keyboardRef} aria-label="模擬瀏覽器鍵盤輸入" defaultValue={'\u200b'} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          placeholder="點選畫面後直接輸入" style={{ width:'100%', maxWidth:'min(100%, 720px)', boxSizing:'border-box', fontSize:16, color:'transparent', WebkitTextSecurity:'disc' }}
          onCompositionStart={() => { composingRef.current = true; suppressCompositionInput.current = false; }}
          onCompositionEnd={e => { composingRef.current = false; sendText(e.currentTarget.value); e.currentTarget.value = '\u200b'; suppressCompositionInput.current = true; }}
          onInput={e => {
            if (composingRef.current || e.nativeEvent.isComposing) return;
            if (e.nativeEvent.inputType === 'insertFromComposition' && suppressCompositionInput.current) { e.currentTarget.value = '\u200b'; suppressCompositionInput.current = false; return; }
            suppressCompositionInput.current = false;
            if (e.nativeEvent.inputType === 'deleteContentBackward') send({ type:'key', key:'Backspace' });
            else if (e.nativeEvent.inputType === 'deleteContentForward') send({ type:'key', key:'Delete' });
            else sendText(e.currentTarget.value);
            e.currentTarget.value = '\u200b';
          }}
          onKeyDown={e => {
            if (composingRef.current || e.nativeEvent.isComposing) return;
            if (['Backspace','Delete','Tab','Enter','ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); send({ type:'key', key:e.key }); }
          }} />}
      </>}</section>
      {result && <section className="history-card history-result"><div className="history-card-heading"><div><h2>{result.identityVerification ? '修課紀錄預覽' : '預覽（虛構資料）'}</h2><p>請查看擷取狀態及資料內容。</p></div></div>{sessionImport && <p>匯入目標：目前登入帳號 {user?.studentId ?? '目前帳號'}。系統不核對 MyFCU 學號，請本人確認來源。</p>}<div className="history-result-stats"><div><span>分類完成</span><strong>{result.categories.filter(c=>c.status==='complete').length} / 6</strong></div><div><span>可匯入候選（未含資料庫比對）</span><strong>{sessionImport ? namePlan.candidates.length : previewRows.length}</strong></div><div><span>已合併重複</span><strong>{(result.duplicateRows ?? 0) + (sessionImport ? namePlan.mergedCount : 0)}</strong></div><div><span>{sessionImport ? '資料衝突' : '成績衝突'}</span><strong>{sessionImport ? namePlan.conflicts.length : result.conflicts}</strong></div></div>
        <div className="history-table-wrap"><table className="history-table"><thead><tr><th>課程</th><th>學分</th><th>學年</th><th>學期</th><th>成績</th><th>狀態</th></tr></thead><tbody>{previewRows.map((r,i)=><tr key={i}><td>{r.courseName}</td><td>{r.credits ?? '未知'}</td><td>{r.academicYear ?? '未知'}</td><td>{r.semester ?? '未知'}</td><td>{r.score ?? '未知'}</td><td>{r.conflictingRows?.length ? <details><summary>資料衝突，需核對</summary>{r.conflictingRows.map((v,j)=><p key={j}>{v.courseName}／{v.credits} 學分／{v.score ?? '未知'}</p>)}</details> : r.needsReview ? '待確認' : '可檢視'}</td></tr>)}</tbody></table></div>
        {sessionImport && namePlan.conflicts.map((conflict,index)=><details key={index}><summary>{conflict.courseName || '未知課程'}：資料衝突，將不匯入</summary>{conflict.rows.flatMap(row=>[row,...(row.conflictingRows ?? [])]).map((row,i)=><p key={i}>學年 {row.academicYear ?? '未知'}／學期 {row.semester ?? '未知'}／課號 {row.courseCode || '未知'}／班級 {row.sourceClassName || '未知'}／成績 {row.score ?? '未知'}</p>)}</details>)}
        <details><summary>排除明細（{result.excludedDetails?.length ?? '無法追溯'}）</summary>{result.excludedDetails ? result.excludedDetails.map((entry,index)=><div key={index}><p>{entry.courseName || '非課程列'}／分類 {entry.category}／原因 {entry.reason}</p><ul>{entry.headers.map((header,i)=><li key={i}>{header}：{entry.values[i] || '空白'}</li>)}</ul></div>) : <p>此預覽產生於追溯功能啟用之前，無法還原排除欄位。</p>}</details>
        <details><summary>重複合併明細（{(result.duplicateDetails?.length ?? 0) + namePlan.mergedCount}）</summary>{!result.duplicateDetails && (result.duplicateRows ?? 0) > 0 && <p>原始跨分類合併明細未保留，須重新擷取。</p>}{[...(result.duplicateDetails ?? []), ...namePlan.candidates.flatMap(retained => (retained.mergedSourceRows ?? []).map(merged => ({retained,merged,reason: 'same_name_matching_score'})))].map((entry,index)=><div key={index}><p>原因：{entry.reason === 'same_attempt_identical' ? '同一次修課跨分類重複' : '同名且成績相同或一筆無成績'}{entry.retained?.academicYear !== entry.merged?.academicYear || entry.retained?.semester !== entry.merged?.semester ? '（跨學期）' : ''}</p><p>保留：{entry.retained?.courseName}／{entry.retained?.academicYear ?? '未知'} 學年／{entry.retained?.semester ?? '未知'} 學期／原始成績 {entry.retained?.sourceCreditRecord ?? entry.retained?.sourceScore ?? entry.retained?.score ?? '未知'}</p><p>合併：{entry.merged?.courseName}／{entry.merged?.academicYear ?? '未知'} 學年／{entry.merged?.semester ?? '未知'} 學期／原始成績 {entry.merged?.sourceCreditRecord ?? entry.merged?.sourceScore ?? entry.merged?.score ?? '未知'}</p></div>)}</details>
        {result.categories.map(c=><p key={c.hash}>分類 {c.hash}：{c.status === 'complete' ? '完成' : '未完成'}，原始列數 {c.rowSummary?.rawRows ?? c.rowCount ?? '未知'}</p>)}
        <p>此階段僅供預覽，尚未寫入或匯入資料庫。</p>
        {sessionImport && snapshotMeta && <p>快照保存在伺服器記憶體，重啟後失效；有效至 {new Date(snapshotMeta.expiresAt).toLocaleString()}。</p>}
        {sessionImport && preflight && <p>目標：{preflight.studentId}（user_id={preflight.numericId}）；預計新增 {preflight.summary.inserted}、更新 {preflight.summary.updated ?? 0}、跳過 {preflight.summary.skipped}、衝突 {preflight.summary.conflicts}。</p>}
        {(sessionImport || localSelfAttested) && result.allCategoriesComplete && (!sessionImport || namePlan.candidates.length > 0) && <button className="history-button history-button-primary" type="button" disabled={importing || (sessionImport ? (!snapshotMeta || !preflight || preflight.summary.conflicts > 0 || preflight.hash !== snapshotMeta.hash) : status !== 'ready') || systemSession.status !== 'valid' || !Number.isSafeInteger(systemSession.numericId)} onClick={async()=>{setImporting(true);setMessage('');try{const summary=await courseHistoryImportAPI.auto(sessionImport ? snapshotMeta?.hash : undefined);finishImport(summary);}catch(error){setMessage(error.message||'匯入失敗，請稍後重試。');setImporting(false);}}}>確認匯入目前帳號</button>}
        {!realPublic && !localPreview && result.allCategoriesComplete && <button className="history-button history-button-primary" type="button" onClick={()=>{handoff.current=isolatedMysqlE2E;navigate('/history-import',{state:{mockHistory:result}});}}>使用虛構資料測試匯入</button>}</section>}
    </>}
  </main>;
}
