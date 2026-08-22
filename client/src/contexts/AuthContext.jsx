import { useEffect, useState } from 'react';
import { AuthContext } from './AuthContextValue';
import { authAPI, privacyAPI } from '../services/api';

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
  const [privacyStatus, setPrivacyStatus] = useState(null);
  const [privacyLoading, setPrivacyLoading] = useState(Boolean(user));

  useEffect(() => {
    let cancelled = false;
    authAPI.getMe()
      .then(current => {
        if (cancelled) return;
        setPrivacyLoading(true);
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

  const refreshPrivacy = async () => {
    if (!user) {
      setPrivacyStatus(null);
      setPrivacyLoading(false);
      return null;
    }
    setPrivacyLoading(true);
    try {
      const status = await privacyAPI.getConsents();
      setPrivacyStatus(status);
      return status;
    } finally {
      setPrivacyLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setPrivacyStatus(null);
      setPrivacyLoading(false);
      return undefined;
    }
    setPrivacyLoading(true);
    privacyAPI.getConsents()
      .then(status => { if (!cancelled) setPrivacyStatus(status); })
      .catch(err => {
        if (!cancelled) setPrivacyStatus({
          requiresAction: true,
          error: err.message || '無法確認資料使用設定',
          consents: {},
        });
      })
      .finally(() => { if (!cancelled) setPrivacyLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const login = (userData) => {
    setPrivacyLoading(true);
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
    setPrivacyStatus(null);
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
      privacyStatus, privacyLoading, refreshPrivacy,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
