import { useState, useEffect } from 'react';
import { ThemeContext } from './ThemeContextValue';

// roadmap #28 雙帳號驗收時特別檢查過 `fcu_theme`：它沒有 `fcu:<studentId>:`
// 前綴，登出也不清除，切帳號會沿用前一個帳號選的主題。**這是刻意的，不是
// 遺漏**——淺色／深色是這台裝置、這個瀏覽器的顯示偏好，跟哪個學生登入無關，
// 比照瀏覽器本身「記住這台電腦的深色模式」的慣例。裁定為裝置偏好而非
// 個人資料：不加前綴、不隨帳號切換或登出清除。
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('fcu_theme') || 'light';
  });

  useEffect(() => {
    localStorage.setItem('fcu_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
