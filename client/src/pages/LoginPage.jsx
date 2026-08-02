import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, GraduationCap, Loader2 } from 'lucide-react';
import { authAPI } from '../services/api';
import { useAuth } from '../contexts/useAuth';

export default function LoginPage() {
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!studentId || !password) {
      setError('請輸入學號與密碼');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await authAPI.login(studentId, password);
      if (res.success) {
        login(res.user);
        navigate('/onboarding');
      }
    } catch (err) {
      setError(err.message || '登入失敗，請確認帳號密碼');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page" id="login-page">
      <div className="login-card animate-fadeInUp">
        <div className="login-logo">
          <div className="login-logo-icon">
            <GraduationCap size={32} />
          </div>
        </div>
        <h1 className="login-title">逢甲大學排課系統</h1>
        <p className="login-subtitle">Smart Schedule Planner</p>

        <form onSubmit={handleLogin} className="login-form">
          <div className="login-field">
            <label className="login-label" htmlFor="login-student-id">學號</label>
            <input
              id="login-student-id"
              className="login-input"
              type="text"
              placeholder="請輸入學號"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="login-password">密碼</label>
            <div className="login-password-wrapper">
              <input
                id="login-password"
                className="login-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="請輸入密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                className="login-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                id="toggle-password-btn"
                tabIndex={-1}
                aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                title={showPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" id="login-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-submit-btn"
            disabled={loading}
            id="login-submit-btn"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                登入中...
              </>
            ) : (
              '登入'
            )}
          </button>
        </form>

        <p className="login-footer">
          © 2026 逢甲大學 資訊工程學系
        </p>
      </div>
    </div>
  );
}
