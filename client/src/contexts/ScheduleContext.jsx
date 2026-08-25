import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authAPI, scheduleAPI } from '../services/api';
import { useAuth } from './useAuth';
import { ScheduleContext } from './ScheduleContextValue';
import {
  INTERACTION_EVENT_TYPES,
  INTERACTION_SOURCES,
  courseRef,
  buildRecommendation,
  courseSource,
  courseTerm,
  hasPersonalizationConsent,
  logInteraction,
  newActionId,
  newUuid,
} from '../services/interactionLog';

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
  // 目前畫面上這份課表來自哪一次推薦。從 saved_schedules 載回時為 null——
  // 那份課表確實不屬於任何一次推薦曝光，不偽造關聯。
  const recommendationRef = useRef(null);
  const privacyRef = useRef(privacyStatus);
  privacyRef.current = privacyStatus;

  // 回傳 promise 供需要知道結果的呼叫端使用（目前只有確認列）。
  // 其餘埋點一律忽略回傳值，維持 fire-and-forget。
  const emit = useCallback((events) => (
    logInteraction(events, privacyRef.current)
  ), []);

  // 屬於某次推薦的操作沿用該次的 requestId；不屬於任何推薦的操作自己開一個，
  // 讓「這個操作不來自推薦」本身成為可讀的資訊。
  const requestIdForAction = useCallback(() => (
    recommendationRef.current?.requestId || newUuid()
  ), []);

  const replaceSchedule = useCallback((nextSchedule, recommendation = null) => {
    const normalized = Array.isArray(nextSchedule) ? nextSchedule : [];
    scheduleRef.current = normalized;
    recommendationRef.current = recommendation;
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
        // 加入後才記錄。驗證沒過的課從來沒有進過課表，記成「使用者選了」是錯的。
        scheduleRef.current = proposed;
        setSchedule(proposed);
        emit(buildCourseEvent(INTERACTION_EVENT_TYPES.COURSE_SELECTED, course, {
          requestId: requestIdForAction(),
          source: courseSource(course, {
            systemRecommendedIds: recommendationRef.current?.systemRecommendedIds,
          }),
        }));
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
  }, [emit, requestIdForAction]);

  // `feedbackReason` 為 7 個 enum 之一或 null（使用者略過）。
  // 本系統沒有連學校選課系統，「退掉已經在課表上的課」就是 roadmap #2 的
  // 「加選後退選」，因此送 `course_withdrawn` 而不是 `course_removed`。
  const removeCourse = useCallback((id, { feedbackReason = null } = {}) => {
    const removed = scheduleRef.current.find(course => courseId(course) === String(id));
    const next = scheduleRef.current.filter(course => courseId(course) !== String(id));
    scheduleRef.current = next;
    setSchedule(next);

    if (removed) {
      emit(buildCourseEvent(INTERACTION_EVENT_TYPES.COURSE_WITHDRAWN, removed, {
        requestId: requestIdForAction(),
        source: courseSource(removed, {
          systemRecommendedIds: recommendationRef.current?.systemRecommendedIds,
        }),
        feedbackReason,
      }));
    }
  }, [emit, requestIdForAction]);

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
      const watching = next.includes(id);
      emit(buildCourseEvent(
        watching
          ? INTERACTION_EVENT_TYPES.COURSE_FAVORITED
          : INTERACTION_EVENT_TYPES.COURSE_UNFAVORITED,
        course,
        {
          requestId: requestIdForAction(),
          source: courseSource(course, {
            systemRecommendedIds: recommendationRef.current?.systemRecommendedIds,
          }),
        }
      ));
      return { success: true, watching };
    } catch (err) {
      return { success: false, message: `關注清單更新失敗：${err.message}` };
    }
  }, [emit, requestIdForAction, watchlist]);

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

  // 開啟課程詳情。放在 context 而不是各頁自己送，兩個頁面才不會各記一套。
  const logCourseViewed = useCallback((course) => {
    if (!course) return;
    emit(buildCourseEvent(INTERACTION_EVENT_TYPES.COURSE_VIEWED, course, {
      requestId: requestIdForAction(),
      source: courseSource(course, {
        systemRecommendedIds: recommendationRef.current?.systemRecommendedIds,
      }),
    }));
  }, [emit, requestIdForAction]);

  // 推薦清單「實際被顯示」。candidateSet 是系統算出來的候選，displayedSet 是
  // 畫面真的渲染出來的；兩者分開，未顯示的課才不會被誤讀成「看過但拒絕」。
  const logRecommendationExposed = useCallback((result, { surface, trigger }) => {
    if (!result?.requestId) return;
    const displayed = (result.schedule || []).map(courseRef).filter(Boolean);
    const excluded = (result.excludedCourses || [])
      .map(item => courseRef(item?.course))
      .filter(Boolean);
    const seen = new Set();
    const candidateSet = [...displayed, ...excluded].filter(ref => {
      if (seen.has(ref.sectionId)) return false;
      seen.add(ref.sectionId);
      return true;
    });
    if (candidateSet.length === 0) return;

    const primary = Array.isArray(result.plans) ? result.plans[0] : null;
    emit({
      eventType: INTERACTION_EVENT_TYPES.RECOMMENDATION_EXPOSED,
      requestId: result.requestId,
      actionId: newActionId(),
      term: firstTerm(result.schedule) || firstTerm((result.excludedCourses || []).map(i => i?.course)),
      plan: primary?.planId ? { planId: primary.planId, variantId: primary.variantId } : null,
      position: { planRank: primary?.planId ? 1 : null, courseRank: null },
      exposureContext: { surface, trigger, candidateSet, displayedSet: displayed },
      source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
      versionSnapshot: { recommendationReasonVersion: null },
    });
  }, [emit]);

  const logScheduleRegenerated = useCallback((requestId, { surface, trigger }) => {
    emit({
      eventType: INTERACTION_EVENT_TYPES.SCHEDULE_REGENERATED,
      requestId: requestId || newUuid(),
      actionId: newActionId(),
      term: firstTerm(scheduleRef.current) || { academicYear: 114, semester: '下學期' },
      exposureContext: { surface, trigger, candidateSet: [], displayedSet: [] },
      versionSnapshot: { recommendationReasonVersion: null },
    });
  }, [emit]);

  // 「這份課表符合我的需求」——roadmap #2 的「使用者最終選擇」。
  // 儲存課表刻意**不**視為接受：存草稿也會按儲存，語意含糊。
  const acceptRecommendation = useCallback(async () => {
    const recommendation = recommendationRef.current;
    // 這份課表不是本次推薦產生的（例如從已存課表載回），沒有方案可以接受。
    if (!recommendation?.planId) return { recorded: false, reason: 'NO_PLAN' };
    return emit({
      eventType: INTERACTION_EVENT_TYPES.RECOMMENDATION_ACCEPTED,
      requestId: recommendation.requestId,
      actionId: newActionId(),
      term: firstTerm(scheduleRef.current) || { academicYear: 114, semester: '下學期' },
      plan: { planId: recommendation.planId, variantId: recommendation.variantId },
      position: { planRank: 1, courseRank: null },
      source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
      versionSnapshot: { recommendationReasonVersion: null },
    });
  }, [emit]);

  // 沒同意個人化學習的人不該被問移除原因——問了也不會記錄，只是白白多一步。
  const personalizationEnabled = hasPersonalizationConsent(privacyStatus);

  const value = useMemo(() => ({
    schedule,
    watchlist,
    loading,
    saving,
    validating,
    personalizationEnabled,
    replaceSchedule,
    addCourse,
    removeCourse,
    toggleWatchlist,
    saveCurrentSchedule,
    buildRecommendation,
    logCourseViewed,
    logRecommendationExposed,
    logScheduleRegenerated,
    acceptRecommendation,
  }), [
    acceptRecommendation, addCourse, loading, logCourseViewed, logRecommendationExposed,
    logScheduleRegenerated, personalizationEnabled, removeCourse, replaceSchedule,
    saveCurrentSchedule, saving, schedule, toggleWatchlist, validating, watchlist,
  ]);

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

// 事件需要學年學期，但學期屬於課程而不是使用者。取候選課程中第一個有值的，
// 全部都沒有就回 null，由呼叫端決定要不要送。
function firstTerm(courses) {
  for (const course of courses || []) {
    const term = courseTerm(course);
    if (term) return term;
  }
  return null;
}

function buildCourseEvent(eventType, course, { requestId, source, feedbackReason = null }) {
  const ref = courseRef(course);
  const term = courseTerm(course);
  // 缺穩定課號或學期就不送。補空值上去只會產生一筆無法解讀的事件。
  if (!ref || !term) return null;
  return {
    eventType,
    requestId,
    actionId: newActionId(),
    course: ref,
    term,
    source,
    ...(feedbackReason ? { feedbackReason } : {}),
    versionSnapshot: { recommendationReasonVersion: null },
  };
}
