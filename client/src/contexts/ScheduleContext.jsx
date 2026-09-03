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

  // roadmap #27：這次排課回傳的**全部**方案，供方案切換與比較讀取。
  // 從 saved_schedules 載回或尚未排課時為空陣列——那份課表不屬於任何一次
  // 推薦，沒有「其他方案」可以切換。
  const [plans, setPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  // 塌縮說明（原本幾個 variant、合併成幾個、可競爭池多大）。屬於整次排課
  // 結果，不屬於單一方案，切換方案不受影響。
  const [planDiversity, setPlanDiversity] = useState(null);

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

  // `resultPlans` 是這次排課回傳的**全部**方案（`result.plans`），不是只有
  // 選中的那一個。省略時（帳號切換清空、從已存課表載回）方案清單一併清空——
  // 那些情境本來就沒有「其他方案」。
  const replaceSchedule = useCallback((nextSchedule, recommendation = null, resultPlans = [], diversity = null) => {
    const normalized = Array.isArray(nextSchedule) ? nextSchedule : [];
    const normalizedPlans = Array.isArray(resultPlans) ? resultPlans : [];
    scheduleRef.current = normalized;
    recommendationRef.current = recommendation;
    setSchedule(normalized);
    setPlans(normalizedPlans);
    setSelectedPlanId(recommendation?.variantId ?? normalizedPlans[0]?.id ?? null);
    setPlanDiversity(diversity);
  }, []);

  // roadmap #27：切換到方案清單裡的另一個方案。
  //
  // 不是重新排課，是把畫面換成**同一次排課結果**裡的另一個方案——`requestId`
  // 沿用，`plans` 不變，只有 `schedule`／`recommendationRef`／`selectedPlanId`
  // 跟著換。watched／explicit／時間未定課程不會遺失：它們本來就是每個 plan
  // 各自帶著的欄位（`watchedCourses`／`unscheduledCourses`），切換時自然跟著
  // 選中的方案換過去，不需要另外保存。
  const selectPlan = useCallback((variantId) => {
    const target = plans.find(plan => plan.id === variantId);
    if (!target) return false;

    const baseRecommendation = recommendationRef.current;
    scheduleRef.current = target.schedule;
    recommendationRef.current = {
      requestId: baseRecommendation?.requestId ?? null,
      planId: target.planId ?? null,
      variantId: target.id,
      systemRecommendedIds: new Set(
        target.schedule.map(course => String(course.id ?? course.sectionId))
      ),
    };
    setSchedule(target.schedule);
    setSelectedPlanId(variantId);
    return true;
  }, [plans]);

  // 目前選中的完整方案物件——課表以外的欄位（`unscheduledCourses`／
  // `watchedCourses`／`warnings`／`excludedCourses`／`planMetrics` 讀不到就得
  // 去 `plans` 裡自己找，這裡先找好給頁面用）。`planDiversity` 是整次排課
  // 結果的欄位、不屬於單一方案，另外用 `planDiversityRef` 保存。
  const activePlan = useMemo(
    () => plans.find(plan => plan.id === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  );

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

  // `feedbackReason` 為 7 個 enum 之一或 null；null 只代表未蒐集原因（例如未啟用
  // 個人化或舊呼叫端），退課原因對話框本身不再提供略過選項。
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

  // roadmap #28：與 `addCourse`／`toggleWatchlist` 同一個世代檢查——這裡原本
  // 沒有。`await` 之後才回傳，若使用者在請求送出後、回應回來前切換帳號，
  // 畫面會用**新帳號的 session**去存**舊帳號畫面上的課表**，儲存結果落到
  // 錯的人身上。時間窗很窄（切帳號快到能插進一次 HTTP 往返之間），雙帳號
  // 驗收沒有實際重現，但與既有兩處的防護是同一類漏洞，補齊避免不對稱。
  const saveCurrentSchedule = useCallback(async (name = '我的課表') => {
    const requestedGeneration = accountGenerationRef.current;
    setSaving(true);
    try {
      const current = scheduleRef.current;
      const totalCredits = current.reduce((sum, course) => sum + Number(course?.credits || 0), 0);
      const result = await scheduleAPI.save(name, current, totalCredits);
      if (requestedGeneration !== accountGenerationRef.current) {
        return { success: false, message: '登入帳號已變更，未儲存課表。' };
      }
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

  // `recommendation_exposed` 不再由前端回報。
  //
  // 對抗式審查發現：由使用者的瀏覽器自己說「系統顯示了什麼」，等於任何登入
  // 帳號都能捏一組假的曝光紀錄，再讓後續的接受／退選對上它。現在改由伺服器
  // 在 `services/scheduleService.js` 算出排課結果的當下自己寫入；後端也已把
  // 這個事件類型從一般寫入路徑擋掉（見 `interactionEventService.js` 的
  // `allowExposureWrite`），前端送了也不會被接受。

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
    // roadmap #27：能切換方案之後，接受的不一定是第 1 名。`plans` 已依
    // `comparePlans()` 排序，索引 + 1 就是使用者實際接受的排名——固定寫死
    // 1 會在使用者切到別的方案後說謊。
    const rank = plans.findIndex(plan => plan.id === recommendation.variantId);
    return emit({
      eventType: INTERACTION_EVENT_TYPES.RECOMMENDATION_ACCEPTED,
      requestId: recommendation.requestId,
      actionId: newActionId(),
      term: firstTerm(scheduleRef.current) || { academicYear: 114, semester: '下學期' },
      plan: { planId: recommendation.planId, variantId: recommendation.variantId },
      position: { planRank: rank >= 0 ? rank + 1 : 1, courseRank: null },
      source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
      versionSnapshot: { recommendationReasonVersion: null },
    });
  }, [emit, plans]);

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
    logScheduleRegenerated,
    acceptRecommendation,
    // roadmap #27
    plans,
    selectedPlanId,
    activePlan,
    planDiversity,
    selectPlan,
  }), [
    acceptRecommendation, activePlan, addCourse, loading, logCourseViewed,
    logScheduleRegenerated, personalizationEnabled, planDiversity, plans,
    removeCourse, replaceSchedule, saveCurrentSchedule, saving, schedule,
    selectedPlanId, selectPlan, toggleWatchlist, validating, watchlist,
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
