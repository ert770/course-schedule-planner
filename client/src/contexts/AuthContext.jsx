import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check localStorage for persisted session
    const stored = localStorage.getItem('fcu_user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem('fcu_user');
      }
    }
    setLoading(false);
  }, []);

  const login = (userData) => {
    setUser(userData);
    localStorage.setItem('fcu_user', JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('fcu_user');
    localStorage.removeItem('fcu_onboarded');
    localStorage.removeItem('fcu_setup_done');
  };

  const markOnboarded = () => {
    localStorage.setItem('fcu_onboarded', 'true');
  };

  const markSetupDone = () => {
    localStorage.setItem('fcu_setup_done', 'true');
  };

  const isOnboarded = () => localStorage.getItem('fcu_onboarded') === 'true';
  const isSetupDone = () => localStorage.getItem('fcu_setup_done') === 'true';

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#f0f2f5', color: '#6b7280', fontSize: '1rem'
      }}>
        載入中...
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{
      user, login, logout,
      isLoggedIn: !!user,
      markOnboarded, markSetupDone,
      isOnboarded, isSetupDone,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthContext;
