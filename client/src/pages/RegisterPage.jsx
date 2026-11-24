import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { authAPI } from '../services/api';

const initial = { studentId: '', name: '', department: '', gradeLevel: '', className: '', password: '', confirmPassword: '' };
export default function RegisterPage() {
  const [form, setForm] = useState(initial);
  const [departments, setDepartments] = useState([]);
  const [abbreviations, setAbbreviations] = useState({});
  const [prefix, setPrefix] = useState('');
  const [classSuffix, setClassSuffix] = useState('');
  const [touched, setTouched] = useState({});
  const [loading, setLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    authAPI.registerOptions().then(data => { if (active) { setDepartments(data.departments); setAbbreviations(data.abbreviations); } })
      .catch(() => { if (active) setError('無法載入系所，請重新整理再試。'); })
      .finally(() => { if (active) setOptionsLoading(false); });
    return () => { active = false; };
  }, []);
  const departmentPrefixes = abbreviations[form.department] ?? [];
  const allowedSuffixes = form.gradeLevel === '1' ? ['甲', '乙', '丙'] : ['甲', '乙', '丙', '丁'];
  const gradeChar = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五' }[form.gradeLevel];
  const className = prefix && gradeChar && classSuffix ? prefix + gradeChar + classSuffix : '';
  const update = e => {
    const { name, value } = e.target;
    setForm(old => ({ ...old, [name]: value }));
    if (name === 'department') {
      const choices = abbreviations[value] ?? [];
      setPrefix(choices.length === 1 ? choices[0] : '');
      setClassSuffix('');
    }
    if (name === 'gradeLevel') {
      setClassSuffix(old => value === '1' && old === '丁' ? '' : old);
    }
  };
  const markTouched = e => setTouched(old => ({ ...old, [e.target.name]: true }));
  const studentInvalid = touched.studentId && !/^D[0-9]{7}$/.test(form.studentId);
  const passwordInvalid = touched.password && (!/^[A-Za-z0-9]{8,}$/.test(form.password) || form.password.length > 1024);
  const confirmationInvalid = touched.confirmPassword && form.confirmPassword !== form.password;
  const submit = async e => {
    e.preventDefault(); setError('');
    if (!/^D[0-9]{7}$/.test(form.studentId)) return setError('學號須為大寫 D 加上 7 位數字。');
    if (!/^[A-Za-z0-9]{8,}$/.test(form.password) || form.password.length > 1024) return setError('密碼至少 8 位字元，僅限英文字母及數字。');
    if (form.password !== form.confirmPassword) return setError('兩次輸入的密碼不一致。');
    setLoading(true);
    try { await authAPI.register({ ...form, className }); navigate('/login', { replace: true, state: { registered: true } }); }
    catch (err) { setError(err.message || '註冊失敗，請稍後再試。'); }
    finally { setLoading(false); }
  };
  return <main className="login-page"><div className="login-card animate-fadeInUp">
    <div className="login-logo"><div className="login-logo-icon"><GraduationCap size={32} /></div></div>
    <h1 className="login-title">建立學生帳號</h1><p className="login-subtitle">填寫基本資料，開始規劃你的課表</p>
    <form className="login-form" onSubmit={submit}>
      <label className="login-label">學號<input className="login-input" name="studentId" value={form.studentId} onChange={update} onFocus={markTouched} aria-invalid={Boolean(studentInvalid)} aria-describedby={studentInvalid ? "student-id-error" : undefined} pattern="D[0-9]{7}" placeholder="D 加 7 位數字" autoComplete="username" required />{studentInvalid && <span className="register-field-error" id="student-id-error">*非正常學號</span>}</label>
      <label className="login-label">姓名<input className="login-input" name="name" value={form.name} onChange={update} placeholder="請輸入真實姓名" maxLength={45} autoComplete="name" required /></label>
      <label className="login-label">系所<select className="login-input" name="department" value={form.department} onChange={update} disabled={optionsLoading} required><option value="">請選擇系所</option>{departments.map(d => <option key={d}>{d}</option>)}</select></label>
      <label className="login-label">年級<select className="login-input" name="gradeLevel" value={form.gradeLevel} onChange={update} required><option value="">請選擇年級</option>{[1, 2, 3, 4, 5].map(g => <option key={g} value={g}>{g} 年級</option>)}</select></label>
      {departmentPrefixes.length > 1 && <label className="login-label">班級系所簡稱<select className="login-input" value={prefix} onChange={e => { setPrefix(e.target.value); setClassSuffix(''); }} required><option value="">請選擇班級系所簡稱</option>{departmentPrefixes.map(item => <option key={item} value={item}>{item}</option>)}</select></label>}
      <label className="login-label">班級<select className="login-input" value={classSuffix} onChange={e => setClassSuffix(e.target.value)} required disabled={!prefix || !form.gradeLevel}><option value="">請選擇班級</option>{allowedSuffixes.map(item => <option key={item} value={item}>{prefix}{gradeChar}{item}</option>)}</select></label>
      <label className="login-label">密碼<input className="login-input" type="password" name="password" value={form.password} onChange={update} onFocus={markTouched} aria-invalid={Boolean(passwordInvalid)} aria-describedby={passwordInvalid ? "password-error" : undefined} minLength={8} maxLength={1024} pattern="[A-Za-z0-9]{8,}" placeholder="至少 8 位字元，僅限英文字母及數字" autoComplete="new-password" required />{passwordInvalid && <span className="register-field-error" id="password-error">*至少 8 位字元，僅限英文字母及數字</span>}</label>
      <label className="login-label">確認密碼<input className="login-input" type="password" name="confirmPassword" value={form.confirmPassword} onChange={update} onFocus={markTouched} aria-invalid={Boolean(confirmationInvalid)} aria-describedby={confirmationInvalid ? "confirm-password-error" : undefined} minLength={8} maxLength={1024} autoComplete="new-password" required />{confirmationInvalid && <span className="register-field-error" id="confirm-password-error">*兩次輸入的密碼不一致</span>}</label>
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="login-submit-btn" disabled={loading || optionsLoading} type="submit">{loading ? '建立中…' : '建立帳號'}</button>
    </form><p className="login-footer"><Link to="/login">返回登入</Link></p>
  </div></main>;
}
