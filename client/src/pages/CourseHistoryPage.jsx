import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { courseHistoryAPI } from '../services/api';

export default function CourseHistoryPage() {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    courseHistoryAPI.list().then(result => { if (active) setRecords(result.records); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  return <main className="history-page">
    <Link className="history-back" to="/">← 返回首頁</Link>
    <header className="history-heading"><div><span className="history-eyebrow">COURSE HISTORY</span><h1>歷史修課紀錄</h1><p>檢視已保存的修課資料與課程匹配狀態。</p></div>{records && <span className="history-count">共 {records.length} 筆</span>}</header>
    {error && <p className="history-alert" role="alert">{error}</p>}
    {!error && records === null && <div className="history-empty">正在載入修課紀錄…</div>}
    {records?.length === 0 && <div className="history-empty">尚無修課紀錄。</div>}
    {records?.length > 0 && <section className="history-card"><div className="history-card-heading"><div><h2>修課列表</h2><p>未匹配的課程會顯示來源課號，未知資料以「未知」標示。</p></div></div><div className="history-table-wrap"><table className="history-table">
      <thead><tr><th>課號</th><th>課程名稱</th><th>學年</th><th>學期</th><th>學分</th><th>成績</th><th>等第</th><th>通過狀態</th></tr></thead>
      <tbody>{records.map(row => <tr key={row.id}>
        <td><span className="history-code">{row.catalogCourseCode ?? row.sourceCourseCode ?? '未提供課號'}</span>{row.catalogCourseCode == null && <span className="history-badge">{row.matchReason === 'missing_term_catalog' ? '缺少該學期比對資料' : '未匹配'}</span>}</td>
        <td>{row.courseName ?? '未知'}</td><td>{row.academicYear ?? '未知'}</td><td>{row.semester ?? '未知'}</td><td>{row.credits ?? '未知'}</td>
        <td>{row.score ?? '未知'}</td><td>{row.letterGrade ?? '未知'}</td><td>{row.passed == null ? '未知' : row.passed ? '通過' : '未通過'}</td>
      </tr>)}</tbody>
    </table></div></section>}
  </main>;
}
