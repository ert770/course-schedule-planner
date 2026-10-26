import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, LayoutDashboard, Search, Compass, Settings, GraduationCap, ShieldCheck, Sun, Moon, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/useAuth';
import { useTheme } from '../../contexts/useTheme';

// 共用頂部導覽列（2026-10-26）。先前首頁、尋找課程、探索、畢業學分各自複製一份，內容漂移：
// 畢業學分頁還留著指向已移除頁面的「排課」，探索、尋找課程、畢業學分頁的選單少了「隱私與資料」。
// 四頁改用同一個元件，選單內容只在這裡維護。
const ICON_STYLE = { marginRight: '8px' };
const LINKS = [
  { key: 'home', path: '/', label: '首頁', icon: <LayoutDashboard size={16} /> },
  { key: 'search', path: '/search', label: '尋找課程', icon: <Search size={16} /> },
  { key: 'explore', path: '/explore', label: '探索', icon: <Compass size={16} /> },
];

const MENU = [
  { path: '/setup', label: '個人資料設定', icon: <Settings size={16} style={ICON_STYLE} /> },
  { path: '/graduation', label: '畢業學分進度', icon: <GraduationCap size={16} style={ICON_STYLE} /> },
  { path: '/privacy', label: '隱私與資料', icon: <ShieldCheck size={16} style={ICON_STYLE} /> },
];

export default function TopNav({ active }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const name = user?.name || '同學';

  return (
    <header className="top-nav">
      <div className="nav-brand">
        <Calendar size={20} className="nav-icon" />
        <span>課表規劃助手</span>
      </div>
      <div className="nav-links">
        {LINKS.map(({ key, path, label, icon }) => (
          <button
            key={key}
            type="button"
            className={`nav-btn${active === key ? ' active' : ''}`}
            onClick={() => { if (active !== key) navigate(path); }}
            aria-current={active === key ? 'page' : undefined}
          >
            {icon} {label}
          </button>
        ))}
      </div>
      <div className="nav-actions">
        <div className="nav-user" ref={menuRef} onClick={() => setOpen(prev => !prev)}>
          <div className="avatar">{name[0]}</div>
          <span>{name}</span>
          {open && (
            <div className="user-dropdown-menu">
              {MENU.map(({ path, label, icon }) => (
                <button key={path} type="button" className="user-dropdown-item" onClick={() => navigate(path)}>
                  {icon} {label}
                </button>
              ))}
              <button type="button" className="user-dropdown-item" onClick={toggleTheme}>
                {theme === 'dark' ? <Sun size={16} style={ICON_STYLE} /> : <Moon size={16} style={ICON_STYLE} />}
                切換主題（{theme === 'dark' ? '淺色' : '深色'}）
              </button>
              <div style={{ height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />
              <button type="button" className="user-dropdown-item" onClick={logout}>
                <LogOut size={16} style={ICON_STYLE} /> 登出
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
