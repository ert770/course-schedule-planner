import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useSchedule } from '../contexts/useSchedule';
import { profileAPI, historyFeedbackAPI } from '../services/api';
import HistoryFeedbackModal from '../components/Profile/HistoryFeedbackModal';
import InterestQuestionnaire from '../components/Profile/InterestQuestionnaire';
import CreditRangeInput from '../components/Profile/CreditRangeInput';
import { creditRangeFromProfile, creditRangePayload, validateCreditRange } from '../utils/creditRange';
import PreferenceJourneySteps, { PreferenceBackButton } from '../components/Layout/PreferenceJourneySteps';
import { ArrowRight, Loader2 } from 'lucide-react';
import { getUserIdentity } from '../utils/userIdentity';
import {
  getInterestExplorationState,
  startInterestExploration,
} from '../services/interestExplorationState';

const sections = ['基本資料', '課程興趣', '排課條件'];

function scheduleOptionLines(options = {}) {
  const lines = [
    [options.maxCoursesPerDay, value => `每天最多 ${value} 門課`],
    [options.courseCredits, value => `可選課每門 ${value} 學分`],
    [options.preferredCourseCredits, value => `偏好每門 ${value} 學分`],
    [options.noEveningClasses ? true : null, () => '不排晚課'],
    [options.language, value => `可選課授課語言 ${value === 'English' ? '英文' : '中文'}`],
  ].filter(([value]) => value != null).map(([value, label]) => label(value));
  for (const [key, label] of [
    ['avoidInstructors', '避開教師'], ['preferredInstructors', '偏好教師'], ['includeInstructors', '指定教師'],
    ['includeCategories', '可選課類別'], ['excludeCategories', '避開類別'], ['preferCategories', '偏好類別'],
    ['requiredSectionIds', '指定班次'], ['excludedSectionIds', '排除班次'],
  ]) {
    if (options[key]?.length) lines.push(`${label} ${options[key].join('、')}`);
  }
  for (const [key, label] of [['allowedPeriods', '可上課時段'], ['preferredPeriods', '偏好時段']]) {
    if (!options[key]?.length) continue;
    const days = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
    const entries = days.flatMap((day, index) => {
      const periods = options[key].filter(slot => slot.day === index + 1).map(slot => slot.period);
      return periods.length ? [`${day}第 ${periods.join('、')} 節`] : [];
    });
    lines.push(`${label} ${entries.join('；')}`);
  }
  for (const quota of options.categoryQuotas ?? []) {
    const bounds = [
      [quota.minCourses, '至少', '門'], [quota.maxCourses, '最多', '門'],
      [quota.minCredits, '至少', '學分'], [quota.maxCredits, '最多', '學分'],
    ].filter(([value]) => value != null).map(([value, label, unit]) => `${label} ${value} ${unit}`);
    lines.push(`${quota.category} ${bounds.join('、')}`);
  }
  return lines;
}

export default function SetupPage() {
  const navigate = useNavigate();
  const { state: navigationState } = useLocation();
  const navigationType = useNavigationType();
  const { user, markInitialSchedulePending, isSetupDone, privacyStatus } = useAuth();
  const { savedAvoidances, restoreAvoidedCourse } = useSchedule();
  const [restoringCourse, setRestoringCourse] = useState(null);
  const [restoreError, setRestoreError] = useState('');
  const restoreCourse = async (sectionId) => {
    setRestoringCourse(sectionId);
    setRestoreError('');
    try {
      const result = await restoreAvoidedCourse(sectionId);
      if (!result.success) setRestoreError(result.message);
    } finally {
      setRestoringCourse(null);
    }
  };
  // 階段 5：「我修過的課」——隨時修改對歷史修課的喜好。
  const [historyFeedback, setHistoryFeedback] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMessage, setHistoryMessage] = useState('');
  const personalizationGranted = privacyStatus?.consents?.personalization_learning?.granted === true;
  const openHistoryFeedback = async () => {
    setHistoryLoading(true);
    setHistoryMessage('');
    try {
      const data = await historyFeedbackAPI.get();
      const count = (data?.groups ?? []).reduce((sum, group) => sum + group.courses.length, 0);
      if (count === 0) setHistoryMessage('目前沒有可以回饋的選修、通識或系外修課紀錄。');
      else setHistoryFeedback(data);
    } catch (err) {
      setHistoryMessage(err.message || '修課紀錄載入失敗，請稍後再試。');
    } finally {
      setHistoryLoading(false);
    }
  };
  const userIdentity = getUserIdentity(user);
  const editing = isSetupDone() && !navigationState?.finishOnboarding;
  const exploration = getInterestExplorationState(userIdentity);
  
  // 保留狀態以供 API 使用，但前端隱藏不顯示
  const [department, setDepartment] = useState('資訊工程學系');
  const [gradeLevel, setGradeLevel] = useState('1');
  const [className, setClassName] = useState('');
  const [programType, setProgramType] = useState('');
  const [college, setCollege] = useState('');
  const [enrolledPrograms, setEnrolledPrograms] = useState('');
  const [avoidInstructors, setAvoidInstructors] = useState('');
  
  // 前端會顯示的選項
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [savedTimePreferences, setSavedTimePreferences] = useState([]);
  // 學分上下限：{ floor, value: { min, max, overload } }，讀到 profile 後才有值。
  const [credits, setCredits] = useState(null);
  const [savedOptions, setSavedOptions] = useState([]);

  const [selectedTags, setSelectedTags] = useState(new Set());
  const [tagGroups, setTagGroups] = useState([]);
  // 課程主題的選擇結果：[{ group, categoryId, level, mode, tagIds }]，以 (group, categoryId) 為鍵。
  // 通識與系外都有「語言」時各自一筆，取消其中一組不影響另一組。
  const [topicSelections, setTopicSelections] = useState([]);
  const [savedTopicSelections, setSavedTopicSelections] = useState(null);
  const [topicSummary, setTopicSummary] = useState(null);
  // 保存成功但有主題標籤沒能保存時，先讓使用者看到說明再離開。
  const [saveNotice, setSaveNotice] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [setupStep, setSetupStep] = useState(0);

  const goToStep = (step) => {
    setSetupStep(step);
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    let cancelled = false;
    profileAPI.getPreferenceTags()
      .then(data => {
        if (!cancelled) setTagGroups(data.groups || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (userIdentity === null) {
      setProfileLoaded(true);
      return () => { cancelled = true; };
    }

    profileAPI.get()
      .then(profile => {
        if (cancelled || !profile) return;
        if (profile.department) setDepartment(profile.department);
        const savedGrade = profile.gradeLevel;
        if (savedGrade) setGradeLevel(String(savedGrade));
        if (profile.className) setClassName(profile.className);
        setProgramType(profile.programType || '');
        setCollege(profile.college || '');
        setEnrolledPrograms((profile.enrolledPrograms || []).join('、'));
        setAvoidInstructors((profile.avoidInstructors || []).join('、'));
        setSavedTimePreferences(Array.isArray(profile.blockedPeriods) ? profile.blockedPeriods : []);
        setCredits(creditRangeFromProfile(profile));
        setSavedOptions(scheduleOptionLines(profile.scheduleOptions));

        if (Array.isArray(profile.selectedTags)) {
          setSelectedTags(new Set(profile.selectedTags));
        }
        const savedSelections = Array.isArray(profile.interestSelections) ? profile.interestSelections : [];
        setTopicSelections(savedSelections);
        setSavedTopicSelections(savedSelections);
        setTopicSummary(profile.interestSummary ?? null);
      })
      .catch(err => {
        if (!cancelled) setProfileError(err.message || '無法讀取偏好，請重新開啟設定頁。');
      })
      .finally(() => {
        if (!cancelled) setProfileLoaded(true);
      });

    return () => { cancelled = true; };
  }, [userIdentity]);

  const toggleTag = (tag) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const continueSetup = () => goToStep(setupStep + 1);

  const handleSubmit = () => {
    if (userIdentity === null) {
      setSaveError('尚未登入，請重新登入後再保存偏好。');
      return;
    }
    persist(topicSelections);
  };

  // 問答確認頁按下確認：已設定過的帳號直接保存（與「保存變更」相同），首次設定則進到排課條件，最後一起保存。
  const confirmTopics = (selections) => {
    setTopicSelections(selections);
    if (editing) persist(selections);
    else goToStep(2);
  };

  const finishAfterSave = (wasSetupDone) => {
    if (!wasSetupDone) {
      navigate('/onboarding/schedule', { replace: true });
      return;
    }
    if (exploration.status === 'in_progress') navigate('/interest-exploration');
    else navigate('/', { state: { preferencesSavedFor: userIdentity } });
  };

  const persist = async (selections) => {
    const wasSetupDone = editing;
    setSaveError('');
    const creditError = credits && validateCreditRange(credits.value, credits.floor);
    if (creditError) {
      setSaveError(creditError);
      setSetupStep(2);
      return;
    }
    setGenerating(true);
    try {
      const prefData = {
        userId: userIdentity,
        department,
        gradeLevel: Number(gradeLevel),
        className,
        programType: programType || null,
        college: college || null,
        enrolledPrograms: enrolledPrograms.split(/[、,，]/).map(value => value.trim()).filter(Boolean),
        avoidInstructors: avoidInstructors.split(/[、,，]/).map(value => value.trim()).filter(Boolean),
        selectedTags: [...selectedTags],
        ...(credits ? creditRangePayload(credits.value) : {}),
        ...(!wasSetupDone ? { initialSetupStage: 'schedule' } : {}),
        // 長期興趣只由課程主題問答保存（ADR-032）；舊的文字興趣欄位已移除。
        ...(selections !== savedTopicSelections ? {
          interestSelections: selections.map(({ group, categoryId, level, mode, tagIds }) => ({
            group, categoryId, level, mode, tagIds,
          })),
        } : {}),
      };
      // 1. 儲存個人偏好設定（回應帶課程主題選擇的驗證狀態，下面據此決定要不要顯示提示）
      const result = await profileAPI.update(prefData);

      if (!wasSetupDone) markInitialSchedulePending();
      const warnings = result?.interestSelectionWarnings ?? [];
      if (result?.interestSelectionsStatus === 'unverified') {
        setSaveNotice({
          wasSetupDone,
          message: '其他設定都已保存。目前無法確認課程主題的標籤是否適用，這次只保存了你選的類別，之後可以再回來補選具體主題。',
        });
        return;
      }
      if (warnings.length > 0) {
        setSaveNotice({
          wasSetupDone,
          message: '其他設定都已保存。有部分主題標籤不在你目前的候選課程裡，已略過，沒有保存。',
        });
        return;
      }
      finishAfterSave(wasSetupDone);
    } catch (err) {
      console.error('Setup failed:', err);
      setSaveError(err.message || '偏好設定儲存失敗，請稍後重試。');
    } finally {
      setGenerating(false);
    }
  };

  const reopenInterestExploration = ({ restart = false } = {}) => {
    if (userIdentity === null) return;
    if (restart || exploration.status !== 'in_progress') startInterestExploration(userIdentity);
    navigate('/interest-exploration');
  };

  return (
    <div className="setup-page" id="setup-page">
      <div className="setup-card" style={{ maxWidth: '850px', width: '100%' }}>
        <PreferenceBackButton onClick={() => navigate(editing
          ? (exploration.status === 'in_progress' ? '/interest-exploration' : '/')
          : '/onboarding')}>
          {editing ? (exploration.status === 'in_progress' ? '返回探索' : '返回首頁') : '返回修課紀錄'}
        </PreferenceBackButton>
        {!editing && <PreferenceJourneySteps current={3} />}
        {navigationState?.historyImported && navigationType !== 'POP' && <p role="status">修課紀錄同步完成</p>}

        <header className="preference-page-header">
          <h1>{editing ? '調整排課偏好' : '設定你的排課偏好'}</h1>
          <p>{editing ? '直接選擇要修改的區塊，完成後保存。' : '先確認基本資料，再選課程興趣和排課條件。'}</p>
        </header>

        {generating ? (
          <div className="setup-generating">
            <div className="setup-generating-spinner">
              <Loader2 size={48} className="spin-animation" />
            </div>
            <h2>正在保存偏好…</h2>
          </div>
        ) : (
          <div className="setup-content">
            <nav className="setup-journey-sections" aria-label="偏好設定區塊">
              {sections.map((section, index) => (
                <button type="button" key={section}
                  aria-current={index === setupStep ? 'step' : undefined}
                  onClick={() => goToStep(index)}
                  disabled={!profileLoaded || Boolean(profileError) || (!editing && index > setupStep)}>
                  {section}
                </button>
              ))}
            </nav>
            {setupStep === 0 && (
              <div className="setup-topic-section">
                <div className="setup-section-box" style={{ background: 'var(--bg-secondary, #f9fafb)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, #e5e7eb)' }}>
                  <h3 className="setup-section-title" style={{ marginBottom: '16px', fontSize: '1.05rem', fontWeight: '600' }}>確認基本資料</h3>
                  <p className="setup-student-scope" role="status">{profileLoaded
                    ? [department, gradeLevel ? gradeLevel + ' 年級' : '', className].filter(Boolean).join(' · ') || '尚無基本資料'
                    : '正在讀取基本資料…'}</p>

                  {profileLoaded && !className && <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '12px 0 0 0' }}>目前沒有班別資料，課程主題選項可能無法顯示。</p>}
                </div>
                <div className="setup-section-box history-feedback-setup" id="history-feedback">
                  <div>
                    <h3 className="setup-section-title">歷史修課回饋</h3>
                                        {!personalizationGranted && <p className="history-feedback-hint">需要先在隱私設定同意「從互動持續改善個人化」。</p>}
                    {historyMessage && <p className="history-feedback-hint">{historyMessage}</p>}
                  </div>
                  <button type="button" className="course-card-action" onClick={openHistoryFeedback} disabled={!personalizationGranted || historyLoading}>
                    {historyLoading ? '載入中…' : '填寫回饋'}
                  </button>
                </div>
              </div>
            )}

            {setupStep === 1 && (
              <div className="setup-topic-section">
                <div className="setup-pref-group" id="interest-preferences" style={{ marginBottom: '20px' }}>
                  <div style={{ marginBottom: '12px' }} id="interest-topic-groups">
                    <h5 className="setup-pref-category" style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
                      想接觸的課程主題
                    </h5>
                    {/* 課程主題問答 v1（ADR-027）：取代原本三組分類按鈕與追問對話框。 */}
                    <InterestQuestionnaire
                      scope={{ department, gradeLevel: Number(gradeLevel), className }}
                      savedSelections={topicSelections}
                      savedSummary={topicSummary}
                      confirmLabel={editing ? '確認並儲存' : '確認並繼續'}
                      onConfirm={confirmTopics}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setTopicSelections([]);
                    }}
                    style={{ marginTop: '8px', padding: 0, border: 'none', background: 'none', color: '#3b82f6', cursor: 'pointer' }}
                  >
                    目前沒有特定方向，先平均探索
                  </button>
                </div>

              </div>
            )}

            {setupStep === 2 && (
              <section className="setup-section-box" aria-labelledby="setup-scheduling-title">
                <h2 id="setup-scheduling-title" className="setup-section-title">設定排課條件</h2>
                <p className="setup-journey-summary">選擇你希望課表符合的時段、集中程度與其他安排。</p>
                {credits && (
                  <div className="setup-pref-group">
                    <h3 className="setup-pref-category">這學期想修的學分</h3>
                    <CreditRangeInput idPrefix="setup-credit" value={credits.value} floor={credits.floor}
                      onChange={value => setCredits(current => ({ ...current, value }))} />
                  </div>
                )}
                {editing && (savedTimePreferences.length > 0 || savedOptions.length > 0) && (
                  <div className="setup-pref-group">
                    <h3 className="setup-pref-category">已保存的時段與其他條件</h3>
                    {savedOptions.map(line => <p key={line}>{line}</p>)}
                    {['週一', '週二', '週三', '週四', '週五', '週六', '週日'].map((day, index) => {
                      const periods = savedTimePreferences.filter(entry => entry.day === index + 1)
                        .map(entry => entry.period).sort((a, b) => a - b);
                      return periods.length > 0 && <p key={day}>{day}第 {periods.join('、')} 節不排課</p>;
                    })}
                  </div>
                )}
                {editing && (savedAvoidances.length > 0 || restoreError) && (
                  <div className="setup-pref-group">
                    <h3 className="setup-pref-category">避開的課程</h3>
                    {restoreError && <p className="setup-error" role="alert">{restoreError}</p>}
                    {savedAvoidances.map(course => (
                      <div className="history-feedback-row" key={course.sectionId}>
                        <span>{course.courseName}{course.catalogCourseCode && `（${course.catalogCourseCode}）`}</span>
                        <button type="button" className="course-card-action restore-avoidance-button" disabled={restoringCourse !== null}
                          onClick={() => restoreCourse(course.sectionId)}>
                          {restoringCourse === course.sectionId ? '處理中…' : '解除避開'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="setup-journey-review">
                  <span>主題分類：{topicSelections.length} 組</span>
                  <span>已確認細項：{new Set(topicSelections.flatMap(item => item.tagIds ?? [])).size} 個</span>
                  <span>排課偏好：{selectedTags.size} 項</span>
                </div>
                {tagGroups.map(({ category, tags }) => (
                    <div key={category} className="setup-pref-group" style={{ marginBottom: '12px' }}>
                      <h4 className="setup-pref-category" style={{ fontSize: '0.85rem', marginBottom: '6px', color: 'var(--text-secondary)' }}>{category}</h4>
                      <div className="setup-pref-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {tags.map(tag => (
                          <button
                            type="button"
                            key={tag}
                            aria-pressed={selectedTags.has(tag)}
                            className={`setup-tag ${selectedTags.has(tag) ? 'selected' : ''}`}
                            onClick={() => toggleTag(tag)}
                            style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '999px' }}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

              </section>
            )}
          </div>
        )}

        {!generating && (
          <footer className="setup-footer">
            {(saveError || profileError) && <p className="setup-error" role="alert">{saveError || profileError}</p>}
            <div className="setup-journey-actions">
              {!editing && setupStep > 0 && (
                <button type="button" className="course-card-action" onClick={() => goToStep(setupStep - 1)}>上一步</button>
              )}
              {!editing && setupStep < 2 ? (
                <button type="button" className="course-card-action primary" onClick={continueSetup} disabled={!profileLoaded || Boolean(profileError)}>
                  {setupStep === 0 ? '繼續選課程興趣' : '繼續設定排課條件'} <ArrowRight size={17} />
                </button>
              ) : (
                <button type="button" className="course-card-action primary" onClick={handleSubmit} disabled={!profileLoaded || Boolean(profileError)}>
                  {editing ? (exploration.status === 'in_progress' ? '保存並繼續探索' : '保存變更') : '保存並開始排課'} <ArrowRight size={17} />
                </button>
              )}
            </div>

            {profileLoaded && editing && (
              <div className="setup-journey-explore" aria-label="課程興趣探索">
                {exploration.status === 'in_progress' && (
                  <button type="button" className="course-card-action" onClick={() => reopenInterestExploration()}>
                    繼續探索課程
                  </button>
                )}
                <button type="button" className="course-card-action" id="setup-reopen-exploration"
                  onClick={() => {
                    if (exploration.status === 'in_progress' && !window.confirm('要清除目前卡片進度，從第一張重新開始嗎？')) return;
                    reopenInterestExploration({ restart: true });
                  }}>
                  {exploration.status === 'not_started' ? '開始探索課程' : '重新開始探索'}
                </button>
              </div>
            )}
          </footer>
        )}
      </div>
      {saveNotice && (
        <div className="history-feedback-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="save-notice-title" id="interest-save-notice">
          <div className="history-feedback-dialog" style={{ width: '480px' }}>
            <div className="history-feedback-header">
              <div>
                <h3 id="save-notice-title">偏好已保存</h3>
                <p>{saveNotice.message}</p>
              </div>
            </div>
            <div className="history-feedback-footer">
              <button
                type="button"
                className="course-card-action primary"
                id="interest-save-notice-continue"
                onClick={() => { const { wasSetupDone } = saveNotice; setSaveNotice(null); finishAfterSave(wasSetupDone); }}
              >
                繼續
              </button>
            </div>
          </div>
        </div>
      )}
      {historyFeedback && (
        <HistoryFeedbackModal
          data={historyFeedback}
          mode="edit"
          onClose={() => setHistoryFeedback(null)}
          onSaved={({ saved }) => setHistoryMessage(saved > 0 ? `已更新 ${saved} 門課的喜好。` : '')}
        />
      )}
    </div>
  );
}
