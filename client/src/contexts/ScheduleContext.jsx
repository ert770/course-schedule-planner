import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authAPI, scheduleAPI } from '../services/api';
import { useAuth } from './useAuth';
import { ScheduleContext } from './ScheduleContextValue';
import { getUserIdentity } from '../utils/userIdentity';
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
import { resolveSelectionSource } from '../services/selectionSource';

function courseId(course) {
  return String(course?.id ?? course?.sectionId ?? '');
}

function courseIsAvoided(course, avoidances) {
  const code = String(course?.catalogCourseCode ?? '').trim();
  return avoidances.some(entry => String(entry.sectionId) === courseId(course)
    || (code && entry.catalogCourseCode === code));
}

const manualCoursesKey = identity => `fcu:${identity}:manualScheduleCourses`;

function readManualCourses(identity) {
  if (identity === null) return [];
  try {
    const courses = JSON.parse(localStorage.getItem(manualCoursesKey(identity)));
    return Array.isArray(courses) ? courses.filter(courseId) : [];
  } catch {
    return [];
  }
}

function missingManualCourses(schedule, manualCourses) {
  const present = new Set(schedule.map(courseId));
  return manualCourses.filter(course => !present.has(courseId(course)));
}

async function validateManualSelection(courses) {
  const credits = courses.reduce((sum, course) => sum + (Number(course?.credits) || 0), 0);
  if (credits > 30) {
    return { success: false, code: 'CREDIT_CEILING', message: `課表共 ${credits} 學分，已超過絕對上限 30 學分。` };
  }

  const validation = await scheduleAPI.validate(courses);
  const violations = validation?.violations ?? [];
  const onlyCreditOverload = violations.length > 0 && violations.every(item => item.constraintId === 'CREDIT_CEILING');
  if (validation?.valid !== true || (validation.hardConstraintsValid !== true && !onlyCreditOverload)) {
    return { success: false, ...describeValidationFailure(validation), validation };
  }
  return { success: true, validation };
}

// ---------------------------------------------------------------------------
// 本次規劃的避開清單
// ---------------------------------------------------------------------------
// 使用者移除一門課之後按「重新排課」，同一門課常常又被排回來，畫面上沒有任何解釋。
// 原因是移除只做了兩件事：從畫面陣列拿掉，以及（在已同意個人化時）送一筆
// `course_withdrawn`。後者走的是**長期**偏好學習，要累積到門檻才會影響權重，
// 對「下一次重排」完全沒有作用——候選池與限制條件跟上一次一模一樣。
//
// 所以再開一條路：本次避開清單。它是 request-scoped 的排課限制，不是訓練資料，
// 因此**不需要**個人化同意也能生效。兩條路互不取代。
//
// 存在 `sessionStorage` 而不是記憶體：使用者移除了幾門課之後不小心重新整理，
// 避開清單若跟著消失，下一次重排會把課排回來而畫面上沒有任何說明——那正是這次
// 要修掉的症狀。存後端則是另一回事：「這次不想要」不該沉澱成永久設定。
const AVOIDANCE_STORAGE_PREFIX = 'avoidances:';

// 避開範圍由退課原因決定，**保守優先**。
//
// 這份對照要與後端的 `data/planningContextSchema.js` 一致；送去後端的只有
// `sectionId` 與 `reason`，範圍由伺服器重算，這裡算一份純粹是為了畫面顯示。
function avoidanceScopeFor(reason) {
  if (reason === 'content' || reason === 'workload') return 'catalog_course';
  if (reason === 'instructor') return 'instructor';
  return 'section';
}

function avoidanceStorageKey(identity) {
  return `${AVOIDANCE_STORAGE_PREFIX}${identity ?? 'anonymous'}`;
}

// `sessionStorage` 在隱私模式或封鎖 site data 時可能直接丟例外，讀寫都要能失敗。
// 失敗時退回純記憶體狀態——避開條件少了持久性，但不會擋住排課。
function readStoredAvoidances(identity) {
  try {
    const raw = sessionStorage.getItem(avoidanceStorageKey(identity));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredAvoidances(identity, list) {
  try {
    sessionStorage.setItem(avoidanceStorageKey(identity), JSON.stringify(list));
  } catch {
    // 忽略：狀態仍在記憶體裡，這一次規劃照樣生效。
  }
}

function clearStoredAvoidances(identity) {
  try {
    sessionStorage.removeItem(avoidanceStorageKey(identity));
  } catch {
    // 同上。
  }
}

function buildAvoidanceEntry(course, reason) {
  return {
    sectionId: Number(courseId(course)),
    reason: reason ?? null,
    scope: avoidanceScopeFor(reason),
    // 原因為 null 代表「還沒問到」，不是「使用者說沒有原因」——未同意個人化的人
    // 移除課程時不會被問（見 DashboardPage 的說明），由 Chat Agent 補問。
    pendingReason: reason === null || reason === undefined,
    // 以下三個只供畫面顯示。送去後端的 payload 不含它們：後端會自己從 Courses
    // 重查，那是唯一能保證「避開的是真的那門課」的做法。
    courseName: course?.name ?? null,
    catalogCourseCode: course?.catalogCourseCode ?? null,
    instructor: course?.instructor ?? course?.teacher ?? null,
  };
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

  const violation = result?.violations?.[0];
  if (violation) {
    return {
      code: violation.constraintId || 'HARD_CONSTRAINT_VIOLATION',
      message: violation.reason || '這門課不符合目前課表的硬性限制。',
      courses: Array.isArray(violation.courses) ? violation.courses : [],
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
  const userIdentity = getUserIdentity(user);
  const [schedule, setSchedule] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(Boolean(user));
  const [hasSavedSchedule, setHasSavedSchedule] = useState(false);
  const [scheduleSaveError, setScheduleSaveError] = useState('');
  const [scheduleToSave, setScheduleToSave] = useState(null);
  const [validating, setValidating] = useState(false);
  const scheduleRef = useRef([]);
  const saveQueueRef = useRef(Promise.resolve());
  const savedScheduleKeyRef = useRef(null);
  const addQueueRef = useRef(Promise.resolve());
  const accountGenerationRef = useRef(0);
  const latestGenerationRequest = useRef(0);
  const beginScheduleGeneration = useCallback(() => {
    const id = ++latestGenerationRequest.current;
    const account = accountGenerationRef.current;
    return () => id === latestGenerationRequest.current && account === accountGenerationRef.current;
  }, []);
  // 目前畫面上這份課表來自哪一次推薦。從 saved_schedules 載回時為 null——
  // 那份課表確實不屬於任何一次推薦曝光，不偽造關聯。
  const recommendationRef = useRef(null);
  const privacyRef = useRef(privacyStatus);
  privacyRef.current = privacyStatus;

  // roadmap #27：這次排課回傳的**全部**方案，供方案切換與比較讀取。
  // 從 saved_schedules 載回或尚未排課時為空陣列——那份課表不屬於任何一次
  // 推薦，沒有「其他方案」可以切換。
  const [rawPlans, setPlans] = useState([]);
  const [savedAvoidances, setSavedAvoidances] = useState([]);
  const savedAvoidancesRef = useRef([]);
  const plans = useMemo(() => {
    if (!savedAvoidances.length) return rawPlans;
    const available = course => !courseIsAvoided(course, savedAvoidances);
    return rawPlans.map(plan => {
      const schedule = plan.schedule.filter(available);
      const unscheduledCourses = (plan.unscheduledCourses ?? []).filter(available);
      return {
        ...plan,
        schedule,
        unscheduledCourses,
        watchedCourses: (plan.watchedCourses ?? []).filter(available),
        totalCredits: [...schedule, ...unscheduledCourses].reduce((sum, course) => sum + (Number(course.credits) || 0), 0),
      };
    });
  }, [rawPlans, savedAvoidances]);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [recommendedPlanId, setRecommendedPlanId] = useState(null);
  // 塌縮說明（原本幾個 variant、合併成幾個、可競爭池多大）。屬於整次排課
  // 結果，不屬於單一方案，切換方案不受影響。
  const [planDiversity, setPlanDiversity] = useState(null);

  // 本次規劃的避開清單。初始值直接從 sessionStorage 讀回來，使用者重新整理之後
  // 不會發現自己剛做的移除靜默失效。
  const [sessionAvoidances, setSessionAvoidances] = useState(() => readStoredAvoidances(userIdentity));
  const avoidancesRef = useRef(sessionAvoidances);
  // 手動加選由帳號各自保存，只有這些班次會固定帶入下一次排課。
  const manualCoursesRef = useRef([]);
  const commitManualCourses = useCallback(courses => {
    manualCoursesRef.current = courses;
    if (userIdentity === null) return;
    try {
      if (courses.length) localStorage.setItem(manualCoursesKey(userIdentity), JSON.stringify(courses));
      else localStorage.removeItem(manualCoursesKey(userIdentity));
    } catch {
      // 封鎖瀏覽器儲存時，本次使用仍以記憶體中的課程為準。
    }
  }, [userIdentity]);

  // 一律經由這個函式更新，狀態與 sessionStorage 才不會有一邊忘了寫。
  const commitAvoidances = useCallback((next) => {
    avoidancesRef.current = next;
    setSessionAvoidances(next);
    if (next.length > 0) writeStoredAvoidances(userIdentity, next);
    else clearStoredAvoidances(userIdentity);
  }, [userIdentity]);

  const clearSessionAvoidances = useCallback(() => {
    commitAvoidances([]);
  }, [commitAvoidances]);

  const commitSavedAvoidances = useCallback(list => {
    savedAvoidancesRef.current = list;
    setSavedAvoidances(list);
    const manual = manualCoursesRef.current.filter(course => !courseIsAvoided(course, list));
    if (manual.length !== manualCoursesRef.current.length) commitManualCourses(manual);
    const current = scheduleRef.current;
    const next = current.filter(course => !courseIsAvoided(course, list));
    if (next.length !== current.length) {
      scheduleRef.current = next;
      setSchedule(next);
    }
  }, [commitManualCourses]);

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
    const normalized = Array.isArray(nextSchedule)
      ? nextSchedule.filter(course => !courseIsAvoided(course, savedAvoidancesRef.current))
      : [];
    const normalizedPlans = Array.isArray(resultPlans) ? resultPlans : [];
    scheduleRef.current = normalized;
    recommendationRef.current = recommendation;
    setSchedule(normalized);
    setPlans(normalizedPlans);
    setSelectedPlanId(recommendation?.variantId ?? normalizedPlans[0]?.id ?? null);
    setRecommendedPlanId(recommendation?.planId ?? normalizedPlans[0]?.planId ?? null);
    setPlanDiversity(diversity);
  }, []);

  const userAddedCourseIds = useCallback(() => manualCoursesRef.current.map(courseId), []);

  const clearGeneratedSchedule = useCallback(() => {
    replaceSchedule(manualCoursesRef.current);
  }, [replaceSchedule]);

  const applyGeneratedSchedule = useCallback((result, recommendation) => {
    const schedule = Array.isArray(result.schedule) ? result.schedule : [];
    const manuallyAddedIds = new Set(userAddedCourseIds());
    const manuallyAddedUnscheduled = (result.unscheduledCourses ?? [])
      .filter(course => manuallyAddedIds.has(courseId(course)));
    const next = [...schedule, ...missingManualCourses(schedule, manuallyAddedUnscheduled)];
    if (missingManualCourses(next, manualCoursesRef.current).length) return false;
    replaceSchedule(next, recommendation, result.plans, result.planDiversity);
    setScheduleToSave(scheduleRef.current);
    return true;
  }, [replaceSchedule, userAddedCourseIds]);

  const selectPlan = useCallback(variantId => {
    const generation = accountGenerationRef.current;
    const requestId = recommendationRef.current?.requestId;
    const target = rawPlans.find(plan => plan.id === variantId);
    const operation = addQueueRef.current.then(async () => {
      const current = scheduleRef.current;
      if (!target || generation !== accountGenerationRef.current || requestId !== recommendationRef.current?.requestId) {
        return { success: false, message: '可切換的方案已更新，請再試一次。' };
      }

      const available = course => !courseIsAvoided(course, savedAvoidancesRef.current);
      const scheduled = target.schedule.filter(available);
      const unscheduled = (target.unscheduledCourses ?? []).filter(available);
      const missing = missingManualCourses(scheduled, manualCoursesRef.current);
      const added = missingManualCourses(unscheduled, missing);
      const next = [...scheduled, ...missing];
      if (added.length) {
        try {
          const result = await validateManualSelection([...scheduled, ...unscheduled, ...added]);
          if (!result.success) return result;
        } catch (error) {
          return { success: false, message: `無法驗證方案：${error.message}` };
        }
      }

      if (generation !== accountGenerationRef.current || scheduleRef.current !== current) {
        return { success: false, message: '驗證期間課表已更新，請再試一次。' };
      }
      scheduleRef.current = next;
      recommendationRef.current = {
        requestId: requestId ?? null,
        planId: target.planId ?? null,
        variantId: target.id,
        systemRecommendedIds: new Set(scheduled.map(courseId)),
      };
      setSchedule(next);
      setScheduleToSave(next);
      setSelectedPlanId(variantId);
      return { success: true };
    });
    addQueueRef.current = operation.catch(() => undefined);
    return operation;
  }, [rawPlans]);

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
    setScheduleToSave(null);
    setHasSavedSchedule(false);
    setScheduleSaveError('');
    savedScheduleKeyRef.current = null;
    manualCoursesRef.current = readManualCourses(userIdentity);
    replaceSchedule([]);
    commitSavedAvoidances([]);
    setWatchlist(normalizeWatchlist(user?.watchlist));
    // 避開清單是「這個人這一次規劃」的狀態。換帳號時換成那個帳號自己的那一份，
    // 不能讓上一位使用者移除的課繼續影響下一位。
    const storedAvoidances = readStoredAvoidances(userIdentity);
    avoidancesRef.current = storedAvoidances;
    setSessionAvoidances(storedAvoidances);

    if (userIdentity === null) {
      setLoading(false);
      return undefined;
    }

    if (privacyLoading || privacyStatus?.requiresAction !== false) {
      setLoading(true);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      scheduleAPI.getSaved(userIdentity, controller.signal),
      scheduleAPI.getAvoidances(userIdentity, controller.signal),
    ])
      .then(async ([result, avoidanceResult]) => {
        if (cancelled || generation !== accountGenerationRef.current) return;
        commitSavedAvoidances(avoidanceResult.avoidances ?? []);
        const latest = latestSavedSchedule(result?.schedules?.filter(
          saved => String(saved.userId) === String(userIdentity)
        ));
        const saved = (Array.isArray(latest?.scheduleData) ? latest.scheduleData : [])
          .filter(course => !courseIsAvoided(course, savedAvoidancesRef.current));
        const missing = missingManualCourses(saved, manualCoursesRef.current);
        const combined = [...saved, ...missing];
        const valid = !saved.length || !missing.length || (await validateManualSelection(combined)).success;
        if (!cancelled && generation === accountGenerationRef.current) {
          setHasSavedSchedule(Boolean(latest) && valid);
          savedScheduleKeyRef.current = latest ? JSON.stringify(latest.scheduleData) : null;
          replaceSchedule(valid ? combined : manualCoursesRef.current);
        }
      })
      .catch(err => {
        if (!cancelled && generation === accountGenerationRef.current) {
          console.error('Saved schedule load failed:', err);
          replaceSchedule(manualCoursesRef.current);
        }
      })
      .finally(() => {
        if (!cancelled && generation === accountGenerationRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (generation === accountGenerationRef.current) accountGenerationRef.current += 1;
      controller.abort();
    };
  }, [commitSavedAvoidances, privacyLoading, privacyStatus?.requiresAction, replaceSchedule, userIdentity, user?.watchlist]);

  useEffect(() => {
    if (loading || userIdentity === null || scheduleToSave === null) return;
    const generation = accountGenerationRef.current;
    const snapshotKey = JSON.stringify(scheduleToSave);
    const operation = saveQueueRef.current.then(async () => {
      const stillCurrent = () => generation === accountGenerationRef.current;
      if (!stillCurrent() || scheduleRef.current !== scheduleToSave || savedScheduleKeyRef.current === snapshotKey) return;

      try {
        const credits = scheduleToSave.reduce((sum, course) => sum + (Number(course?.credits) || 0), 0);
        await scheduleAPI.save('我的課表', scheduleToSave, credits, userIdentity);
        if (!stillCurrent()) return;
        savedScheduleKeyRef.current = snapshotKey;
        setHasSavedSchedule(true);
        setScheduleSaveError('');
      } catch (error) {
        if (stillCurrent()) setScheduleSaveError(`課表自動儲存失敗：${error.message}`);
      }
    });
    saveQueueRef.current = operation;
  }, [loading, scheduleToSave, userIdentity]);

  // options.source 只接受 exploration（探索頁加入的課），其他值會被忽略——
  // 見 services/selectionSource.js。
  const addCourse = useCallback((course, options = {}) => {
    if (loading) return Promise.resolve({ success: false, message: '正在載入課表，請稍後再加入課程。' });
    const requestedGeneration = accountGenerationRef.current;
    const operation = addQueueRef.current.then(async () => {
      if (requestedGeneration !== accountGenerationRef.current) {
        return { success: false, code: 'ACCOUNT_CHANGED', message: '登入帳號已變更，未加入課程。' };
      }
      const id = courseId(course);
      if (!id) return { success: false, code: 'COURSE_ID_REQUIRED', message: '課程缺少班次識別碼。' };
      if (courseIsAvoided(course, savedAvoidancesRef.current)) {
        return { success: false, message: '這門課已在避開清單中，請先到個人資料設定解除避開。' };
      }
      if (scheduleRef.current.some(item => courseId(item) === id)) {
        return { success: false, code: 'SECTION_ALREADY_SELECTED', message: '這個班次已在課表中。' };
      }

      const current = scheduleRef.current;
      const proposed = [...current, course];

      setValidating(true);
      try {
        const result = await validateManualSelection(proposed);
        if (!result.success) return result;

        if (requestedGeneration !== accountGenerationRef.current) {
          return { success: false, code: 'ACCOUNT_CHANGED', message: '登入帳號已變更，未加入課程。' };
        }
        if (scheduleRef.current !== current) {
          return { success: false, message: '驗證期間課表已更新，請再試一次。' };
        }

        scheduleRef.current = proposed;
        setSchedule(proposed);
        setScheduleToSave(proposed);
        commitManualCourses([...manualCoursesRef.current, course]);
        emit(buildCourseEvent(INTERACTION_EVENT_TYPES.COURSE_SELECTED, course, {
          requestId: requestIdForAction(),
          source: resolveSelectionSource(courseSource(course, {
            systemRecommendedIds: recommendationRef.current?.systemRecommendedIds,
          }), options?.source),
        }));
        return { success: true, course, validation: result.validation };
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
  }, [commitManualCourses, emit, loading, requestIdForAction]);
  // `feedbackReason` 為 7 個 enum 之一或 null；null 只代表未蒐集原因（例如未啟用
  // 個人化或舊呼叫端），退課原因對話框本身不再提供略過選項。
  // 本系統沒有連學校選課系統，「退掉已經在課表上的課」就是 roadmap #2 的
  // 「加選後退選」，因此送 `course_withdrawn` 而不是 `course_removed`。
  const recordWithdrawal = useCallback((removed, feedbackReason, temporary = true) => {
    // 三件事**彼此獨立**：畫面移除、加入本次避開清單、送出長期學習事件。
    // 先前只有第一與第三件，而第三件要累積到門檻才會影響權重——所以下一次重排
    // 的條件跟上一次完全相同，同一門課被排回來是必然。事件寫入失敗（或使用者
    // 根本沒同意個人化）都不該影響前兩件。
    const entry = buildAvoidanceEntry(removed, feedbackReason);
    if (temporary && Number.isInteger(entry.sectionId) && entry.sectionId > 0) {
      commitAvoidances([
        ...avoidancesRef.current.filter(item => item.sectionId !== entry.sectionId),
        entry,
      ]);
    }
    emit(buildCourseEvent(INTERACTION_EVENT_TYPES.COURSE_WITHDRAWN, removed, {
      requestId: requestIdForAction(),
      source: courseSource(removed, {
        systemRecommendedIds: recommendationRef.current?.systemRecommendedIds,
      }),
      feedbackReason,
    }));
  }, [commitAvoidances, emit, requestIdForAction]);

  const changeSavedAvoidance = useCallback((id, avoid, feedbackReason = null) => {
    const generation = accountGenerationRef.current;
    const operation = addQueueRef.current.then(async () => {
      if (generation !== accountGenerationRef.current || userIdentity === null) {
        return { success: false, message: '登入帳號已變更，請再試一次。' };
      }
      const removed = avoid ? scheduleRef.current.find(course => courseId(course) === String(id)) : null;
      if (avoid && !removed) return { success: false, message: '課程已不在目前課表。' };
      const restored = avoid ? null : savedAvoidancesRef.current.find(item => item.sectionId === Number(id));
      try {
        const result = await scheduleAPI.updateAvoidance(userIdentity, id, avoid);
        if (generation !== accountGenerationRef.current) {
          return { success: false, message: '登入帳號已變更。' };
        }
        commitSavedAvoidances(result.avoidances);
        if (removed) {
          setScheduleToSave(scheduleRef.current);
          recordWithdrawal(removed, feedbackReason, false);
        }
        if (restored) {
          commitAvoidances(avoidancesRef.current.filter(item => item.sectionId !== restored.sectionId
            && (!restored.catalogCourseCode || item.catalogCourseCode !== restored.catalogCourseCode)));
        }
        return { success: true };
      } catch (err) {
        return { success: false, message: err.message || '無法儲存避開課程，請再試一次。' };
      }
    });
    addQueueRef.current = operation.catch(() => undefined);
    return operation;
  }, [commitAvoidances, commitSavedAvoidances, recordWithdrawal, userIdentity]);

  const removeCourse = useCallback((id, { feedbackReason = null } = {}) => (
    changeSavedAvoidance(id, true, feedbackReason)
  ), [changeSavedAvoidance]);

  const restoreAvoidedCourse = useCallback(id => changeSavedAvoidance(id, false), [changeSavedAvoidance]);

  // Agent 的換課（ADR-036）：伺服器已挑好不衝堂、符合偏好的新課，這裡先驗證
  // 「拿掉舊課＋加入新課」整份課表，通過才真的移除與加入——驗證失敗時課表完全不動，
  // 不會出現舊課被拿掉、新課卻加不進去的半套狀態。
  const applyCourseSwap = useCallback((swap) => {
    const account = accountGenerationRef.current;
    const operation = addQueueRef.current.then(async () => {
      const current = scheduleRef.current;
      const removeId = String(swap?.removeSectionId ?? '');
      const incoming = swap?.addCourse;
      const incomingId = courseId(incoming);
      const removed = current.find(course => courseId(course) === removeId);
      if (account !== accountGenerationRef.current || !removed || !incomingId || current.some(course => courseId(course) === incomingId)) {
        return { success: false, message: '目前課表與換課時的狀態不同，請重新選擇替代課。' };
      }
      if (courseIsAvoided(incoming, savedAvoidancesRef.current)) {
        return { success: false, message: '替代課在避開清單中，請先到個人資料設定解除避開。' };
      }
      const proposed = [...current.filter(course => courseId(course) !== removeId), incoming];
      const credits = proposed.reduce((sum, course) => sum + Number(course?.credits || 0), 0);
      if (credits > 30) {
        return { success: false, message: `替換後共 ${credits} 學分，超過上限 30 學分。` };
      }
      try {
        const result = await scheduleAPI.validate(proposed);
        if (result?.valid !== true || result?.hardConstraintsValid !== true) {
          return { success: false, ...describeValidationFailure(result) };
        }
      } catch (err) {
        return { success: false, message: `無法驗證課表：${err.message}` };
      }
      if (account !== accountGenerationRef.current || scheduleRef.current !== current) {
        return { success: false, message: '驗證期間課表已變動，請重新選擇替代課。' };
      }
      scheduleRef.current = proposed;
      setSchedule(proposed);
      setScheduleToSave(proposed);
      commitManualCourses([...manualCoursesRef.current.filter(course => courseId(course) !== removeId), incoming]);
      recordWithdrawal(removed, null);
      emit(buildCourseEvent(INTERACTION_EVENT_TYPES.COURSE_SELECTED, incoming, {
        requestId: requestIdForAction(),
        source: courseSource(incoming, {
          systemRecommendedIds: recommendationRef.current?.systemRecommendedIds,
        }),
      }));
      return { success: true, removed };
    });
    addQueueRef.current = operation.catch(() => undefined);
    return operation;
  }, [commitManualCourses, emit, recordWithdrawal, requestIdForAction]);

  // 這次排課實際套用了哪些避開條件——由**伺服器**回報，不是前端自己推的。
  //
  // 這條回路是 Agent 追問原因之後的收尾：使用者在 Chat 回答「作業太多」，伺服器
  // 把該筆的範圍從「單一班次」重算成「整個課號」，前端必須把新範圍寫回
  // sessionStorage。少了這一步，使用者之後按一般「重新排課」時，同課號的其他班次
  // 又會冒出來——原因問了等於沒問。
  //
  // `status` 不是 `applied` 的項目**不得**當成已避開：必修衝突時那門課其實還在
  // 課表裡，畫面若顯示「已避開」就是系統自己說謊。
  const applyResolvedAvoidances = useCallback((applied) => {
    if (!Array.isArray(applied) || applied.length === 0) return;
    const byId = new Map(applied.map(item => [Number(item?.sectionId), item]));
    let changed = false;

    const next = avoidancesRef.current.map(entry => {
      const resolved = byId.get(entry.sectionId);
      if (!resolved) return entry;
      const merged = {
        ...entry,
        reason: resolved.reason ?? entry.reason,
        scope: resolved.scope ?? entry.scope,
        // `pendingReason` 由**伺服器**回報，不能從 `reason` 推。
        // 使用者說「不想說明」時 reason 仍是 null，但那件事已經問過了——
        // 照 reason 推會讓 Agent 每一輪都重新問一次同樣的問題。
        pendingReason: resolved.pendingReason ?? entry.pendingReason,
        status: resolved.status ?? 'applied',
        statusMessage: resolved.message ?? null,
      };
      if (
        merged.reason !== entry.reason || merged.scope !== entry.scope
        || merged.pendingReason !== entry.pendingReason || merged.status !== entry.status
        || merged.statusMessage !== entry.statusMessage
      ) changed = true;
      return merged;
    });

    if (changed) commitAvoidances(next);
  }, [commitAvoidances]);

  // 送給後端的形狀：**只有 sectionId 與 reason**。
  // 課名、課號、教師由伺服器從 Courses 重查；`scope` 由伺服器依 reason 推導。
  const buildAvoidanceConstraints = useCallback(() => (
    avoidancesRef.current.map(entry => ({ sectionId: entry.sectionId, reason: entry.reason }))
  ), []);

  // Chat 要用的「目前規劃狀態」。同樣只送 ID。
  const buildPlanningContext = useCallback(() => ({
    requestId: recommendationRef.current?.requestId ?? null,
    activePlanId: recommendationRef.current?.planId ?? null,
    activeVariantId: recommendationRef.current?.variantId ?? null,
    currentCourses: scheduleRef.current
      .map(course => ({ sectionId: Number(courseId(course)) }))
      .filter(entry => Number.isInteger(entry.sectionId) && entry.sectionId > 0),
    removedCourses: avoidancesRef.current
      .map(entry => ({ sectionId: entry.sectionId, reason: entry.reason })),
  }), []);

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
    const term = firstTerm(scheduleRef.current) || { academicYear: 114, semester: '下學期' };
    const accepted = {
      eventType: INTERACTION_EVENT_TYPES.RECOMMENDATION_ACCEPTED,
      requestId: recommendation.requestId,
      actionId: newActionId(),
      term,
      plan: { planId: recommendation.planId, variantId: recommendation.variantId },
      position: { planRank: rank >= 0 ? rank + 1 : 1, courseRank: null },
      source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
      versionSnapshot: { recommendationReasonVersion: null },
    };

    // roadmap #10 任務 3A：只有「切換列上真的有兩個以上方案可選」時，這次接受才
    // 構成 set-wise choice。`recommendationRef` 追的就是使用者當下切到的方案
    // （見 selectPlan()），所以 accepted 與 chosen 指的是同一個方案。
    // 只顯示單一方案、或從已存課表載回時不送——那只代表「接受推薦」，不是比較過。
    // 後端會用伺服器自己寫的曝光紀錄重新驗證一次，前端送了不代表算數。
    const chosen = plans.length >= 2 ? {
      eventType: INTERACTION_EVENT_TYPES.PLAN_CHOSEN,
      requestId: recommendation.requestId,
      // actionId 由後端依 requestId 決定，這裡送的值會被覆寫。
      actionId: newActionId(),
      term,
      plan: { planId: recommendation.planId, variantId: recommendation.variantId },
      position: { planRank: rank >= 0 ? rank + 1 : 1, courseRank: null },
      versionSnapshot: { recommendationReasonVersion: null },
    } : null;

    return emit([accepted, chosen].filter(Boolean));
  }, [emit, plans]);

  // 沒同意個人化學習的人不該被問移除原因——問了也不會記錄，只是白白多一步。
  const personalizationEnabled = hasPersonalizationConsent(privacyStatus);

  const value = useMemo(() => ({
    schedule,
    watchlist,
    loading,
    hasSavedSchedule,
    scheduleSaveError,
    validating,
    personalizationEnabled,
    applyGeneratedSchedule,
    beginScheduleGeneration,
    clearGeneratedSchedule,
    // 本次規劃的避開清單
    sessionAvoidances,
    savedAvoidances,
    restoreAvoidedCourse,
    clearSessionAvoidances,
    applyResolvedAvoidances,
    buildAvoidanceConstraints,
    buildPlanningContext,
    userAddedCourseIds,
    addCourse,
    removeCourse,
    applyCourseSwap,
    toggleWatchlist,
    buildRecommendation,
    logCourseViewed,
    logScheduleRegenerated,
    acceptRecommendation,
    // roadmap #27
    plans,
    selectedPlanId,
    recommendedPlanId,
    activePlan,
    planDiversity,
    selectPlan,
  }), [
    acceptRecommendation, activePlan, addCourse, applyCourseSwap, applyGeneratedSchedule, applyResolvedAvoidances,
    beginScheduleGeneration, buildAvoidanceConstraints, buildPlanningContext, clearSessionAvoidances, userAddedCourseIds,
    hasSavedSchedule, loading, logCourseViewed,
    logScheduleRegenerated, personalizationEnabled, planDiversity, plans,
    clearGeneratedSchedule, removeCourse, restoreAvoidedCourse, savedAvoidances, schedule, scheduleSaveError, sessionAvoidances,
    recommendedPlanId, selectedPlanId, selectPlan, toggleWatchlist, validating, watchlist,
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
