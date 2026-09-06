import { useEffect, useState } from 'react';
import { AuthContext } from './AuthContextValue';
import { authAPI, privacyAPI } from '../services/api';
import { getUserIdentity } from '../utils/userIdentity';

const userKey = (studentId, suffix) => `fcu:${studentId}:${suffix}`;
const canBypassSetupForE2E = (user) => Boolean(
  import.meta.env.DEV
  && import.meta.env.VITE_E2E_BYPASS_SETUP === 'true'
  && String(getUserIdentity(user) ?? '').startsWith('BROWSER')
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
    const identity = getUserIdentity(user);
    if (identity !== null) {
      localStorage.removeItem(userKey(identity, 'onboarded'));
      localStorage.removeItem(userKey(identity, 'setupDone'));
    }
    setUser(null);
    setPrivacyStatus(null);
    localStorage.removeItem('fcu_user');
  };

  const markOnboarded = () => {
    const identity = getUserIdentity(user);
    if (identity !== null) localStorage.setItem(userKey(identity, 'onboarded'), 'true');
  };

  const markSetupDone = () => {
    const identity = getUserIdentity(user);
    if (identity !== null) localStorage.setItem(userKey(identity, 'setupDone'), 'true');
  };

  const isOnboarded = () => {
    const identity = getUserIdentity(user);
    return identity !== null && localStorage.getItem(userKey(identity, 'onboarded')) === 'true';
  };
  const isSetupDone = () => Boolean(
    canBypassSetupForE2E(user)
    || (getUserIdentity(user) !== null
      && localStorage.getItem(userKey(getUserIdentity(user), 'setupDone')) === 'true')
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
