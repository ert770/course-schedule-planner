import { useState } from 'react';
import { AuthContext } from './AuthContextValue';

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
