import { useEffect, useState } from 'react';
import { AuthContext } from './AuthContextValue';
import { authAPI } from '../services/api';

const userKey = (studentId, suffix) => `fcu:${studentId}:${suffix}`;
const canBypassSetupForE2E = (user) => Boolean(
  import.meta.env.DEV
  && import.meta.env.VITE_E2E_BYPASS_SETUP === 'true'
  && user?.studentId?.startsWith('BROWSER')
);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('fcu_user');
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch {
      localStorage.removeItem('fcu_user');
      return null;
    }
  });

  useEffect(() => {
    let cancelled = false;
    authAPI.getMe()
      .then(current => {
        if (cancelled) return;
        setUser(current);
        localStorage.setItem('fcu_user', JSON.stringify(current));
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        localStorage.removeItem('fcu_user');
      });
    return () => { cancelled = true; };
  }, []);

  const login = (userData) => {
    setUser(userData);
    localStorage.setItem('fcu_user', JSON.stringify(userData));
  };

  const logout = () => {
    authAPI.logout().catch(() => {});
    if (user?.studentId) {
      localStorage.removeItem(userKey(user.studentId, 'onboarded'));
      localStorage.removeItem(userKey(user.studentId, 'setupDone'));
    }
    setUser(null);
    localStorage.removeItem('fcu_user');
  };

  const markOnboarded = () => {
    if (user?.studentId) localStorage.setItem(userKey(user.studentId, 'onboarded'), 'true');
  };

  const markSetupDone = () => {
    if (user?.studentId) localStorage.setItem(userKey(user.studentId, 'setupDone'), 'true');
  };

  const isOnboarded = () => Boolean(
    user?.studentId && localStorage.getItem(userKey(user.studentId, 'onboarded')) === 'true'
  );
  const isSetupDone = () => Boolean(
    canBypassSetupForE2E(user)
    || (user?.studentId && localStorage.getItem(userKey(user.studentId, 'setupDone')) === 'true')
  );

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
