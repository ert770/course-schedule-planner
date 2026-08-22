import { createContext, useContext, useState } from 'react';
import { useAuth } from './useAuth';

const ScheduleContext = createContext();

export function ScheduleProvider({ children }) {
  const { user } = useAuth();

  // 🌟 透過函式初始化 state，直接從 LocalStorage 讀取，完全不需要 useEffect 觸發 setState！
  const [schedule, setSchedule] = useState(() => {
    if (!user?.studentId) return [];
    const local = localStorage.getItem(`fcu_schedule_${user.studentId}`);
    return local ? JSON.parse(local) : [];
  });

  const [watchlist, setWatchlist] = useState(() => {
    if (!user?.studentId) return [];
    const local = localStorage.getItem(`fcu_watchlist_${user.studentId}`);
    return local ? JSON.parse(local) : [];
  });

  // 存檔邏輯 (純前端 LocalStorage)
  const saveScheduleToLocal = (newSchedule) => {
    if (!user?.studentId) return;
    localStorage.setItem(`fcu_schedule_${user.studentId}`, JSON.stringify(newSchedule));
  };

  const saveWatchlistToLocal = (newWatchlist) => {
    if (!user?.studentId) return;
    localStorage.setItem(`fcu_watchlist_${user.studentId}`, JSON.stringify(newWatchlist));
  };

  // 加退選邏輯
  const addCourse = async (newCourse) => {
    if (schedule.some(c => c.id === newCourse.id)) {
      return { success: false, message: '此課程已在您的課表中。' };
    }
    const newSchedule = [...schedule, newCourse];
    setSchedule(newSchedule);
    saveScheduleToLocal(newSchedule);
    return { success: true, message: `成功將【${newCourse.name}】加入課表！` };
  };

  const removeCourse = (courseId) => {
    const newSchedule = schedule.filter(c => c.id !== courseId);
    setSchedule(newSchedule);
    saveScheduleToLocal(newSchedule);
  };

  const toggleWatchlist = (course) => {
    const isWatched = watchlist.some(c => c.id === course.id);
    const newWatchlist = isWatched 
      ? watchlist.filter(c => c.id !== course.id)
      : [...watchlist, course];
      
    setWatchlist(newWatchlist);
    saveWatchlistToLocal(newWatchlist);
  };

  return (
    <ScheduleContext.Provider value={{ schedule, setSchedule, watchlist, addCourse, removeCourse, toggleWatchlist }}>
      {children}
    </ScheduleContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSchedule = () => useContext(ScheduleContext);