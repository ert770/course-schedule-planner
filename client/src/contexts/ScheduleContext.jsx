import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authAPI, scheduleAPI } from '../services/api';
import { useAuth } from './useAuth';
import { ScheduleContext } from './ScheduleContextValue';

function courseId(course) {
  return String(course?.id ?? course?.sectionId ?? '');
}

function normalizeWatchlist(watchlist) {
  if (!Array.isArray(watchlist)) return [];
  return [...new Set(watchlist.map(item => (
    typeof item === 'object' ? item?.id ?? item?.sectionId : item
  )).filter(id => id !== null && id !== undefined).map(String))];
}

function latestSavedSchedule(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return [...rows].sort((left, right) => {
    const timeDiff = Date.parse(right?.createdAt || '') - Date.parse(left?.createdAt || '');
    if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
    return Number(right?.id || 0) - Number(left?.id || 0);
  })[0];
}

function describeValidationFailure(result) {
  const violation = result?.violations?.[0];
  if (violation) {
    return {
      code: violation.constraintId || 'HARD_CONSTRAINT_VIOLATION',
      message: violation.reason || '這門課不符合目前課表的硬性限制。',
      courses: Array.isArray(violation.courses) ? violation.courses : [],
    };
  }

  const conflict = result?.conflicts?.[0];
  if (conflict) {
    const names = [conflict.course1?.name, conflict.course2?.name].filter(Boolean);
    return {
      code: 'TIME_CONFLICT',
      message: names.length === 2
        ? `「${names[0]}」與「${names[1]}」時段衝突。`
        : '加入後會造成時段衝突。',
      courses: [conflict.course1, conflict.course2].filter(Boolean),
    };
  }

  const duplicate = result?.duplicates?.[0];
  if (duplicate) {
    const names = [duplicate.course1?.name, duplicate.course2?.name].filter(Boolean);
    return {
      code: 'DUPLICATE_COURSE',
      message: names.length > 0
        ? `課表已有「${names[0]}」的其他班次。`
        : '課表已有同一門課的其他班次。',
      courses: [duplicate.course1, duplicate.course2].filter(Boolean),
    };
  }

  return {
    code: 'SCHEDULE_INVALID',
    message: '加入後的課表未通過驗證。',
    courses: [],
  };
}

export function ScheduleProvider({ children }) {
  const { user, privacyStatus, privacyLoading } = useAuth();
  const [schedule, setSchedule] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(Boolean(user));
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const scheduleRef = useRef([]);
  const addQueueRef = useRef(Promise.resolve());
  const accountGenerationRef = useRef(0);

  const replaceSchedule = useCallback((nextSchedule) => {
    const normalized = Array.isArray(nextSchedule) ? nextSchedule : [];
    scheduleRef.current = normalized;
    setSchedule(normalized);
  }, []);

  useEffect(() => {
    accountGenerationRef.current += 1;
    const generation = accountGenerationRef.current;
    replaceSchedule([]);
    setWatchlist(normalizeWatchlist(user?.watchlist));

    if (!user?.studentId) {
      setLoading(false);
      return undefined;
    }

    if (privacyLoading || privacyStatus?.requiresAction !== false) {
      setLoading(true);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    scheduleAPI.getSaved()
      .then(result => {
        if (cancelled || generation !== accountGenerationRef.current) return;
        const latest = latestSavedSchedule(result?.schedules);
        replaceSchedule(Array.isArray(latest?.scheduleData) ? latest.scheduleData : []);
      })
      .catch(err => {
        if (!cancelled && generation === accountGenerationRef.current) {
          console.error('Saved schedule load failed:', err);
          replaceSchedule([]);
        }
      })
      .finally(() => {
        if (!cancelled && generation === accountGenerationRef.current) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [privacyLoading, privacyStatus?.requiresAction, replaceSchedule, user?.studentId, user?.watchlist]);

  const addCourse = useCallback((course) => {
    const requestedGeneration = accountGenerationRef.current;
    const operation = addQueueRef.current.then(async () => {
      if (requestedGeneration !== accountGenerationRef.current) {
        return { success: false, code: 'ACCOUNT_CHANGED', message: '登入帳號已變更，未加入課程。' };
      }
      const id = courseId(course);
      if (!id) return { success: false, code: 'COURSE_ID_REQUIRED', message: '課程缺少班次識別碼。' };
      if (scheduleRef.current.some(item => courseId(item) === id)) {
        return { success: false, code: 'SECTION_ALREADY_SELECTED', message: '這個班次已在課表中。' };
      }

      const proposed = [...scheduleRef.current, course];
      setValidating(true);
      try {
        // scheduleAPI.validate 固定送出 `{ courses }`；只有後端明確通過才加入。
        const result = await scheduleAPI.validate(proposed);
        if (result?.valid !== true || result?.hardConstraintsValid !== true) {
          return { success: false, ...describeValidationFailure(result), validation: result };
        }
        if (requestedGeneration !== accountGenerationRef.current) {
          return { success: false, code: 'ACCOUNT_CHANGED', message: '登入帳號已變更，未加入課程。' };
        }
        replaceSchedule(proposed);
        return { success: true, course, validation: result };
      } catch (err) {
        return {
          success: false,
          code: 'VALIDATION_UNAVAILABLE',
          message: `無法驗證課表，因此未加入課程：${err.message}`,
        };
      } finally {
        setValidating(false);
      }
    });

    addQueueRef.current = operation.catch(() => undefined);
    return operation;
  }, [replaceSchedule]);

  const removeCourse = useCallback((id) => {
    replaceSchedule(scheduleRef.current.filter(course => courseId(course) !== String(id)));
  }, [replaceSchedule]);

  const toggleWatchlist = useCallback(async (course) => {
    const requestedGeneration = accountGenerationRef.current;
    const id = courseId(course);
    if (!id) return { success: false, message: '課程缺少班次識別碼。' };
    const previous = watchlist;
    const next = previous.includes(id)
      ? previous.filter(item => item !== id)
      : [...previous, id];

    try {
      const persistedIds = next.map(value => (/^\d+$/.test(value) ? Number(value) : value));
      const result = await authAPI.updateWatchlist(persistedIds);
      if (requestedGeneration !== accountGenerationRef.current) {
        return { success: false, message: '登入帳號已變更，未更新畫面上的關注清單。' };
      }
      setWatchlist(normalizeWatchlist(result?.watchlist ?? next));
      return { success: true, watching: next.includes(id) };
    } catch (err) {
      return { success: false, message: `關注清單更新失敗：${err.message}` };
    }
  }, [watchlist]);

  const saveCurrentSchedule = useCallback(async (name = '我的課表') => {
    setSaving(true);
    try {
      const current = scheduleRef.current;
      const totalCredits = current.reduce((sum, course) => sum + Number(course?.credits || 0), 0);
      const result = await scheduleAPI.save(name, current, totalCredits);
      return { success: true, saved: result?.schedule };
    } catch (err) {
      return { success: false, message: `課表儲存失敗：${err.message}` };
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo(() => ({
    schedule,
    watchlist,
    loading,
    saving,
    validating,
    replaceSchedule,
    addCourse,
    removeCourse,
    toggleWatchlist,
    saveCurrentSchedule,
  }), [
    addCourse, loading, removeCourse, replaceSchedule, saveCurrentSchedule,
    saving, schedule, toggleWatchlist, validating, watchlist,
  ]);

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}
