import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './useAuth';

const ScheduleContext = createContext();

export function ScheduleProvider({ children }) {
  const { user } = useAuth();
  const [schedule, setSchedule] = useState([]);
  const [watchlist, setWatchlist] = useState([]);

  // 1. 登入或整理網頁時，瞬間從 LocalStorage 讀取草稿 (符合 React ESLint 規範)
  useEffect(() => {
    if (user?.studentId) {
      const localSchedule = localStorage.getItem(`fcu_schedule_${user.studentId}`);
      const localWatchlist = localStorage.getItem(`fcu_watchlist_${user.studentId}`);
      
      // 先準備好要更新的資料，最後一次性設定狀態，避免多次同步呼叫 setState
      const nextSchedule = localSchedule ? JSON.parse(localSchedule) : [];
      const nextWatchlist = localWatchlist ? JSON.parse(localWatchlist) : [];

      setSchedule(nextSchedule);
      setWatchlist(nextWatchlist);
    } else {
      setSchedule([]);
      setWatchlist([]);
    }
  }, [user?.studentId]);

  // 2. 存檔邏輯 (純前端 LocalStorage，不發送 API、不塞爆資料庫)
  const saveScheduleToLocal = (newSchedule) => {
    if (!user?.studentId) return;
    localStorage.setItem(`fcu_schedule_${user.studentId}`, JSON.stringify(newSchedule));
  };

  const saveWatchlistToLocal = (newWatchlist) => {
    if (!user?.studentId) return;
    localStorage.setItem(`fcu_watchlist_${user.studentId}`, JSON.stringify(newWatchlist));
  };

  // 3. 加退選邏輯
  const addCourse = async (newCourse) => {
    if (schedule.some(c => c.id === newCourse.id)) {
      return { success: false, message: '此課程已在您的課表中。' };
    }
    const newSchedule = [...schedule, newCourse];
    setSchedule(newSchedule);
    saveScheduleToLocal(newSchedule); // 異動後立刻寫入瀏覽器
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