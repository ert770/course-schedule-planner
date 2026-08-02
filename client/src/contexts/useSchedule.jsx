import { createContext, useContext, useState } from 'react';

const ScheduleContext = createContext();

export function ScheduleProvider({ children }) {
  const [schedule, setSchedule] = useState([]);
  const [watchlist, setWatchlist] = useState([]);

  const checkConflict = (newCourse) => {
    return schedule.find(course => {
      if (course.dayOfWeek !== newCourse.dayOfWeek) return false;
      const isOverlapping = !(
        newCourse.endPeriod < course.startPeriod || 
        newCourse.startPeriod > course.endPeriod
      );
      return isOverlapping;
    });
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