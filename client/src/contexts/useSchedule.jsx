import { createContext, useContext, useState } from 'react';

const ScheduleContext = createContext();

export function ScheduleProvider({ children }) {
  const [schedule, setSchedule] = useState([]);
  const [watchlist, setWatchlist] = useState([]);

  const checkConflict = async (courseToAdd) => {
  try {
    const proposedSchedule = [...schedule, courseToAdd];

    const response = await fetch('/api/schedule/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule: proposedSchedule })
    });

    const data = await response.json();

    if (data.conflicts?.length > 0 || data.duplicates?.length > 0) {
      console.warn("衝堂或重複選課警告:", data);
      return true; // 告知有衝突
    }

    return false; // 安全過關
  } catch (error) {
    console.error("驗證課表失敗:", error);
    return false; 
  }
};

  const addCourse = (newCourse) => {
    if (schedule.some(c => c.id === newCourse.id)) {
      return { success: false, message: '此課程已在您的課表中。' };
    }
    const conflictCourse = checkConflict(newCourse);
    if (conflictCourse) {
      return { success: false, message: `衝堂警告！與已選的【${conflictCourse.name}】時間重疊。` };
    }
    setSchedule([...schedule, newCourse]);
    return { success: true, message: `成功將【${newCourse.name}】加入課表！` };
  };

  // 🌟 新增：移除課程的函式
  const removeCourse = (courseId) => {
    setSchedule(schedule.filter(c => c.id !== courseId));
  };

  const toggleWatchlist = (course) => {
    const isWatched = watchlist.some(c => c.id === course.id);
    if (isWatched) {
      setWatchlist(watchlist.filter(c => c.id !== course.id));
    } else {
      setWatchlist([...watchlist, course]);
    }
  };

  return (
    // 🌟 將 removeCourse 也暴露出去給其他元件使用
    <ScheduleContext.Provider value={{ schedule, setSchedule, watchlist, addCourse, removeCourse, toggleWatchlist }}>
      {children}
    </ScheduleContext.Provider>
  );
}

export const useSchedule = () => useContext(ScheduleContext);