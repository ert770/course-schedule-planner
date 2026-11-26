import { Fragment, useEffect, useRef, useState } from 'react';
import { AuthContext } from './AuthContextValue';
import { authAPI, privacyAPI } from '../services/api';
import { getUserIdentity } from '../utils/userIdentity';
import { canSkipControlledBrowserSetup } from '../utils/controlledBrowserMock';

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
  const accountVersion = useRef(0);
  const [sessionChecked, setSessionChecked] = useState(false);
  const userIdentity = getUserIdentity(user);

  useEffect(() => {
    let cancelled = false;
    const version = accountVersion.current;
    authAPI.getMe()
      .then(current => {
        if (cancelled || version !== accountVersion.current) return;
        setPrivacyLoading(true);
        setUser(current);
        localStorage.setItem('fcu_user', JSON.stringify(current));
      })
      .catch(() => {
        if (cancelled || version !== accountVersion.current) return;
        setUser(null);
        localStorage.removeItem('fcu_user');
      })
      .finally(() => {
        if (!cancelled && version === accountVersion.current) setSessionChecked(true);
      });
    return () => { cancelled = true; };
  }, []);

  const refreshPrivacy = async () => {
    if (!user) {
      setPrivacyStatus(null);
      setPrivacyLoading(false);
      return null;
    }
    const version = accountVersion.current;
    setPrivacyLoading(true);
    try {
      const status = await privacyAPI.getConsents();
      if (version === accountVersion.current) setPrivacyStatus(status);
      return status;
    } finally {
      if (version === accountVersion.current) setPrivacyLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!sessionChecked) return undefined;
    if (userIdentity === null) {
      setPrivacyStatus(null);
      setPrivacyLoading(false);
      return undefined;
    }
    const version = accountVersion.current;
    const isCurrent = () => !cancelled && version === accountVersion.current;
    setPrivacyLoading(true);
    privacyAPI.getConsents()
      .then(status => { if (isCurrent()) setPrivacyStatus(status); })
      .catch(err => {
        if (isCurrent()) setPrivacyStatus({
          requiresAction: true,
          error: err.message || '無法確認資料使用設定',
          consents: {},
        });
      })
      .finally(() => { if (isCurrent()) setPrivacyLoading(false); });
    return () => { cancelled = true; };
  }, [sessionChecked, userIdentity]);

  const login = (userData) => {
    accountVersion.current += 1;
    setSessionChecked(true);
    setPrivacyStatus(null);
    setPrivacyLoading(true);
    setUser(userData);
    localStorage.setItem('fcu_user', JSON.stringify(userData));
  };

  const logout = () => {
    accountVersion.current += 1;
    setSessionChecked(true);
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
    // 伺服器下次回傳 /auth/me 前，先同步本地的 setupComplete，避免剛存完設定又被導回引導流程。
    if (user && user.setupComplete !== true) {
      const next = { ...user, setupComplete: true, initialSetupStage: 'completed' };
      setUser(next);
      localStorage.setItem('fcu_user', JSON.stringify(next));
    }
  };

  const markInitialSchedulePending = () => {
    if (!user) return;
    const next = { ...user, setupComplete: false, initialSetupStage: 'schedule' };
    setUser(next);
    localStorage.setItem('fcu_user', JSON.stringify(next));
  };

  const isOnboarded = () => {
    const identity = getUserIdentity(user);
    return identity !== null && localStorage.getItem(userKey(identity, 'onboarded')) === 'true';
  };
  // 以伺服器的 `setupComplete`（Profile 已有系所與年級）為準：登出、換裝置後仍算設定過。
  // 伺服器沒有回傳這個欄位時（例如未接 MySQL），才退回瀏覽器裡的 `setupDone` 標記。
  const isSetupDone = () => {
    if (canSkipControlledBrowserSetup(user, import.meta.env.DEV)) return true;
    if (canBypassSetupForE2E(user)) return true;
    if (typeof user?.setupComplete === 'boolean') return user.setupComplete;
    const identity = getUserIdentity(user);
    return identity !== null && localStorage.getItem(userKey(identity, 'setupDone')) === 'true';
  };

  return (
    <AuthContext.Provider value={{
      user, login, logout,
      isLoggedIn: !!user,
      markOnboarded, markSetupDone, markInitialSchedulePending,
      isOnboarded, isSetupDone,
      privacyStatus, privacyLoading: !sessionChecked || privacyLoading, refreshPrivacy,
    }}>
      <Fragment key={getUserIdentity(user) ?? 'signed-out'}>{children}</Fragment>
    </AuthContext.Provider>
  );
}
