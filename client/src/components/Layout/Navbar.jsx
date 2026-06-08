import { NavLink } from 'react-router-dom';
import { Calendar, MessageCircle, User, Home } from 'lucide-react';

export default function Navbar() {
  return (
    <nav className="navbar" id="main-navbar">
      <div className="navbar-brand">
        <span className="navbar-brand-icon">📅</span>
        <span>課表規劃助手</span>
      </div>
      <div className="navbar-nav">
        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end id="nav-home">
          <Home size={18} />
          <span>首頁</span>
        </NavLink>
        <NavLink to="/schedule" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} id="nav-schedule">
          <Calendar size={18} />
          <span>排課</span>
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} id="nav-profile">
          <User size={18} />
          <span>偏好設定</span>
        </NavLink>
      </div>
    </nav>
  );
}
