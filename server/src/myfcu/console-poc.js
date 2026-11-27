/* MyFCU six-category local-only PoC. Paste the entire file into the console.
 * MyFCU's own tab clicks may make its normal authenticated requests.
 * This script does not read credentials or invoke fetch/XHR. */
(function (root) {
  'use strict';
  const TABS = ['#/courseXd', '#/courseKind1', '#/courseXc', '#/courseKind23', '#/courseSelP', '#/courseSelPno'];
  const HEADERS = {
    courseCode: ['課號', '課程編碼', '課程代碼', '科目代碼'], courseName: ['課名', '科目', '課程名稱', '科目名稱'],
    academicYear: ['學年', '學年度', '實際修習學年'], semester: ['學期', '實際修習學期'], credits: ['學分', '修習學分', '實際修習學分'],
    score: ['成績', '分數'], className: ['修讀班級名稱'], graduationCredits: ['計入畢業學分'], creditRecord: ['取得學分記錄'],
  };
  const clean = x => String(x ?? '').replace(/\s+/g, '').trim();
  const REQUIRED_FIELDS = ['courseName', 'academicYear', 'semester', 'credits'];
  const REVIEWABLE_TABS = new Set(['#/courseKind1', '#/courseKind23']);
  function parseTable(table, category, options = {}) {
    const names = table.headers.map(clean);
    const indexes = Object.fromEntries(Object.entries(HEADERS).map(([field, aliases]) => [field, names.findIndex(name => aliases.includes(name))]));
    if (REQUIRED_FIELDS.some(field => indexes[field] < 0) || (indexes.courseCode < 0 && indexes.className < 0)) return { ok: false, records: [], reason: '缺少必要表頭' };
    const records = [], pendingRecords = [], rowDiagnostics = [], excludedDetails = [], unresolvedDetails = [];
    const preserveExcluded = (row, reason) => { if (options.includeTrace) excludedDetails.push({ courseName: String(row[indexes.courseName] ?? '').trim(), category, reason, headers: [...table.headers], values: [...row] }); };
    let invalid = 0, nonCourse = 0, excludedRows = 0;
    for (const [index, row] of table.rows.entries()) {
      const cell = key => String(row[indexes[key]] ?? '').trim();
      const meta = table.rowMeta?.[index] ?? {};
      const merged = Boolean(meta.colspan || meta.rowspan);
      const semester = ({ '1': 1, '2': 2, '3': 3, '上': 1, '下': 2, '暑': 3, '上學期': 1, '下學期': 2, '暑期': 3,
        '暑修': 3, '暑修班': 3, '第1學期': 1, '第2學期': 2, '第一學期': 1, '第二學期': 2, '一': 1, '二': 2 })[clean(cell('semester')).normalize('NFKC')] ?? null;
      // MyFCU 有時會在數字後加單位（「114學年度」「3學分」「3.0」），只剝掉這些明確的單位。
      const unitNumber = (value, unit) => { const m = clean(value).normalize('NFKC').match(new RegExp(`^(\\d+(?:\\.\\d+)?)(?:${unit})?$`)); return m ? Number(m[1]) : null; };
      const year = unitNumber(cell('academicYear'), '學年度|學年'), credits = unitNumber(cell('credits'), '學分');
      const code = cell('courseCode'), name = cell('courseName'), scoreText = cell('score');
      const tokens = row.map(clean).filter(Boolean);
      const emptyNotice = tokens.length === 1 && /^(無資料|查無資料|沒有資料|暫無資料|無修課資料)$/.test(tokens[0]);
      const aggregate = (merged || (!name && !cell('academicYear'))) && /^(合計|總計|小計)$/.test(clean(code)) &&
        tokens.every(token => /^(合計|總計|小計)$/.test(token) || /^\d+(?:\.\d+)?$/.test(token));
      const explanation = merged && tokens.length === 1 && /^(說明|備註|註)$/.test(tokens[0]);
      if (emptyNotice || aggregate || explanation) {
        nonCourse++;
        excludedRows++;
        preserveExcluded(row, emptyNotice ? 'empty_notice' : aggregate ? 'aggregate' : 'explanation');
        rowDiagnostics.push({ rowIndex: index + 1, kind: emptyNotice ? 'empty_notice' : aggregate ? 'aggregate' : 'explanation', merged, cellCount: row.length });
        continue;
      }
      const missingValue = value => /^(|[-—–]|尚無|未出|未公布|尚未公布|未評分|修習中)$/.test(value.trim());
      const actualFields = [cell('academicYear'), cell('semester'), cell('credits')];
      const blank = value => /^(|[-—–]|X)$/i.test(value.trim());
      const knownName = clean(name).normalize('NFKC');
      const noActualTerm = blank(cell('academicYear')) && blank(cell('semester'));
      const noGradeEvidence = blank(scoreText) && blank(cell('creditRecord')) && blank(cell('graduationCredits'));
      const knownEnglishRequirement = options.tabHash === '#/courseKind1' &&
        /^大學基礎英文\([一二]\)$/.test(knownName) && blank(code) && blank(cell('className')) && noActualTerm && noGradeEvidence;
      const unfinishedProject = options.tabHash === '#/courseKind23' &&
        /^專題研究\(二\)$/.test(knownName) && blank(cell('className')) && noActualTerm && noGradeEvidence;
      const unattemptedRequirement = REVIEWABLE_TABS.has(options.tabHash) && name && blank(code) &&
        blank(cell('className')) && noActualTerm && blank(scoreText) &&
        /^X$/i.test(cell('creditRecord')) && blank(cell('graduationCredits'));
      if (!merged && (knownEnglishRequirement || unfinishedProject || unattemptedRequirement)) {
        const reason = knownEnglishRequirement ? 'excluded_known_requirement'
          : unfinishedProject ? 'excluded_unfinished_project' : 'excluded_unattempted_requirement';
        excludedRows++;
        preserveExcluded(row, reason);
        rowDiagnostics.push({ rowIndex: index + 1, kind: reason, merged, cellCount: row.length });
        continue;
      }
      // Only explicit missing values are excluded. Merged cells and unrecognized
      // representations remain unresolved because they may contain real attempts.
      if (!REVIEWABLE_TABS.has(options.tabHash) && code && name && !merged && actualFields.some(missingValue)
          && actualFields.every(value => missingValue(value) || Number.isFinite(Number(value)) || /^(上|下|暑|上學期|下學期|暑期)$/.test(value))) {
        excludedRows++;
        preserveExcluded(row, 'excluded_missing_actual_study');
        rowDiagnostics.push({ rowIndex: index + 1, kind: 'excluded_missing_actual_study', merged, cellCount: row.length });
        continue;
      }
      const reasons = [];
      if (!code && !cell('className')) reasons.push('course_identity_missing');
      if (!name) reasons.push('course_name_empty');
      if (!Number.isInteger(year) || year <= 0) reasons.push(cell('academicYear') ? 'academic_year_unrecognized' : 'academic_year_empty');
      if (!semester) reasons.push(cell('semester') ? 'semester_unrecognized' : 'semester_empty');
      if (credits === null || credits < 0) reasons.push(cell('credits') ? 'credits_unrecognized' : 'credits_empty');
      if (reasons.length) {
        invalid++;
        rowDiagnostics.push({ rowIndex: index + 1, kind: 'unresolved', reasons, ...(!semester && cell('semester') ? { semesterText: clean(cell('semester')).slice(0, 10) } : {}), merged, colspan: Boolean(meta.colspan), rowspan: Boolean(meta.rowspan), cellCount: row.length });
        if (options.includeTrace) unresolvedDetails.push({ courseName: name, rowIndex: index + 1, reasons });
        continue;
      }
      const rawCreditRecord = cell('creditRecord');
      const verifiedCreditScore = options.creditRecordVerified === true && /^\d{1,3}(?:\.\d{1,2})?$/.test(rawCreditRecord) && Number(rawCreditRecord) <= 100;
      const explicitScore = indexes.score >= 0 && /^\d+(?:\.\d{1,2})?$/.test(scoreText) && Number(scoreText) <= 100;
      const gradeConfirmed = explicitScore || verifiedCreditScore;
      const entry = { courseCode: code, courseName: name, academicYear: year, semester, credits, score: gradeConfirmed ? Number(verifiedCreditScore ? rawCreditRecord : scoreText) : null,
        letterGrade: null, sourceScore: scoreText || null, passed: null, requirementType: null,
        generalEducationCategory: null, graduationCategory: null, sourceCategories: [category], sourceClassName: cell('className') || null,
        sourceGraduationCredits: cell('graduationCredits') || null, sourceCreditRecord: rawCreditRecord || null, needsReview: true };
      if (gradeConfirmed) records.push(entry);
      else {
        pendingRecords.push(entry);
        rowDiagnostics.push({ rowIndex: index + 1, kind: 'pending_grade_confirmation', merged, cellCount: row.length });
      }
    }
    return { ok: invalid === 0, records, pendingRecords, validRows: records.length, pendingRows: pendingRecords.length, rawRows: table.rows.length, nonCourseRows: nonCourse, excludedRows, invalidRows: invalid, rowDiagnostics, ...(options.includeTrace ? { excludedDetails, unresolvedDetails } : {}), reason: invalid ? `${invalid} 筆欄位缺漏或格式無法解析` : null };
  }
  async function collect(driver, options = {}) {
    const categories = [], records = new Map(), excludedDetails = [], unresolvedDetails = [], duplicateDetails = [], rawCategories = [];
    let duplicates = 0, conflicts = 0;
    const totalStarted = Date.now();
    for (const hash of TABS) {
      const categoryStarted = Date.now();
      try {
        const result = await driver.load(hash);
        if (!result || !Array.isArray(result.tables) || !result.tables.length) throw new Error('找不到可讀取的表格');
        if (options.includeTrace) rawCategories.push({ hash, category: result.category || hash, tables: result.tables });
        let count = 0, incomplete = false, unreadableTable = false;
        const rowSummary = { rawRows: 0, validRows: 0, pendingRows: 0, nonCourseRows: 0, excludedRows: 0, invalidRows: 0, details: [] };
        for (const [tableIndex, table] of result.tables.entries()) {
          const parsed = parseTable(table, result.category || hash, { ...options, tabHash: hash });
          if (!parsed.ok) incomplete = true;
          if (!parsed.ok && !parsed.invalidRows) unreadableTable = true;
          if (options.includeTrace) excludedDetails.push(...(parsed.excludedDetails ?? []));
          if (options.includeTrace) unresolvedDetails.push(...(parsed.unresolvedDetails ?? []).map(row => ({ ...row, hash, category: result.category || hash, tableIndex: tableIndex + 1 })));
          rowSummary.validRows += parsed.validRows ?? 0;
          rowSummary.pendingRows += parsed.pendingRows ?? 0;
          rowSummary.rawRows += parsed.rawRows ?? 0;
          rowSummary.nonCourseRows += parsed.nonCourseRows ?? 0;
          rowSummary.excludedRows += parsed.excludedRows ?? 0;
          rowSummary.invalidRows += parsed.invalidRows ?? 0;
          rowSummary.details.push(...(parsed.rowDiagnostics ?? []));
          for (const row of [...parsed.records, ...(parsed.pendingRecords ?? [])]) {
            count++;
            const key = JSON.stringify([row.courseCode ? ['code', row.courseCode] : ['name_class', row.courseName, row.sourceClassName], row.academicYear, row.semester]);
            const previous = records.get(key);
            if (!previous) { records.set(key, row); continue; }
            if (['courseName', 'credits', 'sourceScore', 'sourceClassName', 'sourceGraduationCredits', 'sourceCreditRecord'].some(k => previous[k] !== row[k])) {
              conflicts++; previous.conflictingRows ??= []; previous.conflictingRows.push(row);
            } else {
              if (options.includeTrace) duplicateDetails.push({ retained: { ...previous, sourceCategories: [...previous.sourceCategories] }, merged: row, reason: 'same_attempt_identical' });
              duplicates++; previous.sourceCategories = [...new Set([...previous.sourceCategories, ...row.sourceCategories])];
            }
          }
        }
        // 六個分類都一樣：表格讀得到、只有個別列無法辨識時，只略過那幾列（列入待核對），其餘照常匯入。
        // 交換、校際課程的學期或欄位寫法常不在解析規則內，若整類擋下，使用者就完全無法匯入。
        const rowReviewOnly = incomplete && !unreadableTable;
        categories.push({ hash, status: incomplete ? 'incomplete' : 'complete', rowReviewOnly, rowCount: count, rowSummary, elapsedMs: Date.now() - categoryStarted, verification: result.verification, diagnostics: result.diagnostics });
      } catch (error) {
        categories.push({ hash, status: 'incomplete', elapsedMs: Date.now() - categoryStarted, reason: String(error?.message || '載入失敗'), diagnostics: error?.diagnostics });
      }
    }
    const allRecords = [...records.values()];
    const candidates = allRecords.filter(row => row.score !== null && !row.conflictingRows);
    const pendingRecords = allRecords.filter(row => row.score === null || row.conflictingRows);
    const summary = { rawRows: categories.reduce((n, c) => n + (c.rowSummary?.rawRows ?? 0), 0), duplicateRows: duplicates,
      excludedRows: categories.reduce((n, c) => n + (c.rowSummary?.excludedRows ?? 0), 0),
      pendingRows: pendingRecords.length, anomalyRows: categories.reduce((n, c) => n + (c.rowSummary?.invalidRows ?? 0), 0), candidateRows: candidates.length };
    return { allCategoriesComplete: categories.every(c => c.status === 'complete'), categories, records: candidates, pendingRecords, summary, totalElapsedMs: Date.now() - totalStarted,
      duplicateRows: duplicates, conflicts, ...(options.includeTrace ? { excludedDetails, unresolvedDetails, duplicateDetails, rawCategories } : {}), importReady: false,
      notice: '僅供人工核對；通過狀態、修習別、畢業分類未推測，尚不可直接匯入。' };
  }
  function candidateReady(state) {
    return Boolean(state.actualHash === state.targetHash && state.tableCount > 0 && state.recognizedTableCount > 0 &&
      !state.busy && state.stable && state.tableMutatedAtTarget &&
      ((!state.alreadySelected && state.tableChanged) || state.sawBusy || (state.sawPending && state.pendingCount === 0)));
  }
  function completionBasis(state) {
    if (!candidateReady(state)) return null;
    if (!state.alreadySelected && state.tableChanged) return 'target-hash+table-change+target-dom-mutation+stable';
    if (state.sawBusy) return 'target-hash+busy-cycle+target-dom-mutation+stable';
    return 'target-hash+pending-cycle+target-dom-mutation+stable';
  }
  function sanitizedDiagnostics(state) {
    return { targetHash: state.targetHash, actualHash: TABS.includes(state.actualHash) ? state.actualHash : '(其他或未知)',
      tableCount: state.tableCount, rowCount: state.rowCount, recognizedTableCount: state.recognizedTableCount,
      recognizedRowCount: state.recognizedRowCount, headers: state.headers ?? [], dataState: state.dataState ?? 'unknown',
      busy: state.busy, sawBusy: state.sawBusy, tableChanged: state.tableChanged,
      sawPending: state.sawPending, pendingCount: state.pendingCount, tableMutated: state.tableMutated,
      tableMutatedAtTarget: state.tableMutatedAtTarget, completionBasis: completionBasis(state),
      alreadySelected: state.alreadySelected, reason: state.reason ?? null };
  }
  function createBrowserDriver(root) {
  const doc = root.document;
  function visible(node) {
    const style = root.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && !!(node.getClientRects().length || node.offsetWidth || node.offsetHeight);
  }
  function snapshot() {
    const all = [...doc.querySelectorAll('table')].filter(visible).map(table => {
      const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
      const headers = headerRow ? [...headerRow.querySelectorAll('th,td')].map(x => x.textContent.trim()) : [];
      const sourceRows = [...table.querySelectorAll('tbody tr')].filter(row => row !== headerRow && root.getComputedStyle(row).display !== 'none');
      const rows = sourceRows.map(row => [...row.querySelectorAll('td')].map(x => x.textContent.trim()));
      const rowMeta = sourceRows.map(row => ({ colspan: [...row.querySelectorAll('td')].some(cell => cell.colSpan > 1), rowspan: [...row.querySelectorAll('td')].some(cell => cell.rowSpan !== 1) }));
      return { headers, rows, rowMeta };
    });
    const recognized = all.filter(table => parseTable({ headers: table.headers, rows: [] }, '').ok);
    return { all, recognized };
  }
  function signature(tables) { return JSON.stringify(tables); }
  // Diagnostics use a fixed whitelist so a mistaken data row cannot leak content.
  const knownHeaders = new Set(Object.values(HEADERS).flat().map(clean));
  function diagnosticHeaders(tables) { return tables.map(table => table.headers.map(header => knownHeaders.has(clean(header)) ? clean(header) : '[未辨識欄位]')); }
  const busy = () => [...doc.querySelectorAll('[aria-busy="true"], [role="progressbar"], .loading, .spinner')].some(visible);
  function pendingCount() {
    try {
      const injector = root.angular?.element(doc.body)?.injector?.() ?? root.angular?.element(doc.documentElement)?.injector?.();
      const value = injector?.get('$http')?.pendingRequests?.length;
      return Number.isInteger(value) ? value : null;
    } catch { return null; }
  }
  function waitForCandidate(hash, before, alreadySelected, observation, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const started = Date.now(); let last = null, stableSince = 0, sawBusy = false, sawPending = false;
      function check() {
        const snap = snapshot(), current = signature(snap.recognized), isBusy = busy(), pending = pendingCount();
        sawBusy ||= isBusy;
        sawPending ||= pending !== null && pending > 0;
        if (current !== last) { last = current; stableSince = Date.now(); }
        const state = { targetHash: hash, actualHash: root.location.hash, tableCount: snap.all.length,
          recognizedTableCount: snap.recognized.length, rowCount: snap.all.reduce((n, t) => n + t.rows.length, 0),
          recognizedRowCount: snap.recognized.reduce((n, t) => n + t.rows.length, 0), headers: diagnosticHeaders(snap.all),
          dataState: isBusy ? 'loading' : !snap.all.length ? 'table-not-loaded' : !snap.recognized.length ? 'header-mismatch' : snap.recognized.some(t => t.rows.length) ? 'rows-present' : 'empty-unconfirmed',
          busy: isBusy || (pending !== null && pending > 0), sawBusy, sawPending, pendingCount: pending,
          tableChanged: current !== before, tableMutated: observation.tableMutated, tableMutatedAtTarget: observation.tableMutatedAtTarget,
          alreadySelected, stable: Date.now() - stableSince >= 500 };
        if (candidateReady(state)) return resolve({ tables: snap.recognized, diagnostics: sanitizedDiagnostics(state) });
        if (Date.now() - started > timeout) {
          state.reason = state.actualHash !== hash ? '頁籤 Hash 未切換' : state.busy ? '載入狀態未結束' :
            !state.tableCount ? '沒有可見表格' : !state.recognizedTableCount ? '表頭未符合目前解析規則' : '缺少目標頁籤下的表格變化或載入完成訊號';
          const error = new Error(state.reason); error.diagnostics = sanitizedDiagnostics(state); return reject(error);
        }
        root.setTimeout(check, 150);
      }
      check();
    });
  }
  return { async load(hash) {
    const link = [...doc.querySelectorAll('a[href]')].find(node => node.getAttribute('href') === hash);
    if (!link) { const error = new Error('找不到分類頁籤'); error.diagnostics = sanitizedDiagnostics({ targetHash: hash, actualHash: root.location.hash, tableCount: 0, rowCount: 0, recognizedTableCount: 0, reason: error.message }); throw error; }
    const before = signature(snapshot().recognized), alreadySelected = root.location.hash === hash;
    const label = link.textContent.trim() || hash;
    const observation = { tableMutated: false, tableMutatedAtTarget: false };
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const node = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        if (node && (node.closest?.('table') || [...mutation.addedNodes, ...mutation.removedNodes].some(n => n.nodeType === 1 && (n.matches?.('table') || n.querySelector?.('table'))))) {
          observation.tableMutated = true;
          if (root.location.hash === hash) observation.tableMutatedAtTarget = true;
        }
      }
    });
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
    try {
      link.click();
      const candidate = await waitForCandidate(hash, before, alreadySelected, observation);
      const d = candidate.diagnostics;
      const confirmed = snapshot();
      if (root.location.hash !== hash || busy() || signature(confirmed.recognized) !== signature(candidate.tables)) {
        const error = new Error('確認時頁面已變動，請重新執行'); error.diagnostics = { ...d, reason: error.message }; throw error;
      }
      return { category: label, tables: confirmed.recognized, verification: d.completionBasis, diagnostics: d };
    } finally { observer.disconnect(); }
  } };
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { TABS, parseTable, collect, candidateReady, sanitizedDiagnostics, createBrowserDriver }; return; }
  if (!root.confirm('個資使用告知：將在此裝置讀取修課紀錄及成績，切換頁籤可能觸發 MyFCU 原有資料載入。腳本不讀取登入憑證、不主動上傳；請確認後才下載檔案。是否同意開始？')) return;
  const creditRecordVerified = root.confirm('成績驗證模式預設關閉。只有你已先將「取得學分記錄」與自己的正式成績逐筆核對，並確認數字代表成績時，才按「確定」啟用轉換；否則按「取消」。是否已完成核對並啟用？');
  const doc = root.document;
  const driver = createBrowserDriver(root);
  function download(name, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = doc.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    doc.body.appendChild(a); a.click(); a.remove(); root.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  collect(driver, { creditRecordVerified }).then(result => {
    const done = result.categories.filter(c => c.status === 'complete').length;
    const overlay = doc.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.8)', zIndex: '2147483647', overflow: 'auto', padding: '2rem', color: '#111' });
    const panel = doc.createElement('div');
    Object.assign(panel.style, { background: '#fff', padding: '1rem', maxWidth: '1000px', margin: 'auto' });
    const title = doc.createElement('h2'); title.textContent = `本機預覽：完成 ${done}/${TABS.length} 分類`;
    const info = doc.createElement('p'); info.textContent = '資料含個資與成績。請逐項核對；不完整或有衝突時不可視為正式匯入資料。';
    const preview = doc.createElement('pre'); preview.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto';
    preview.textContent = JSON.stringify(result, null, 2);
    const full = doc.createElement('button'); full.textContent = '確認後下載完整 JSON';
    full.onclick = () => { if (root.confirm('確認已檢視內容，下載含個資的 JSON 至本機？')) download('myfcu-course-history-poc.json', result); };
    const diagnostic = doc.createElement('button'); diagnostic.textContent = '下載不含課程資料的診斷檔';
    diagnostic.onclick = () => download('myfcu-poc-diagnostics.json', { allCategoriesComplete: result.allCategoriesComplete, summary: result.summary, totalElapsedMs: result.totalElapsedMs,
      categories: result.categories.map(c => ({ hash: c.hash, status: c.status, elapsedMs: c.elapsedMs, rowSummary: c.rowSummary ?? null, diagnostics: c.diagnostics ?? null })) });
    const close = doc.createElement('button'); close.textContent = '關閉'; close.onclick = () => overlay.remove();
    panel.append(title, info, full, diagnostic, close, preview); overlay.append(panel); doc.body.append(overlay);
  }).catch(() => root.alert('擷取中斷，未產生下載。'));
})(globalThis);
