import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { profileAPI, historyFeedbackAPI, coursesAPI, scheduleAPI } from '../services/api';
import HistoryFeedbackModal from '../components/Profile/HistoryFeedbackModal';
import InterestFollowupDialog from '../components/Profile/InterestFollowupDialog';
import PreferenceJourneySteps, { PreferenceBackButton } from '../components/Layout/PreferenceJourneySteps';
import { followupKey } from '../utils/interestSelections';
import { ArrowRight, Loader2 } from 'lucide-react';
import { getUserIdentity } from '../utils/userIdentity';
import {
  getInterestExplorationState,
  startInterestExploration,
} from '../services/interestExplorationState';

const sections = ['基本資料', '課程興趣', '排課條件'];

export default function SetupPage() {
  const navigate = useNavigate();
  const { user, markSetupDone, isSetupDone, privacyStatus } = useAuth();
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
  const editing = isSetupDone();
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
  const [mbti, setMbti] = useState('INTJ');
  const [remainingSemesters, setRemainingSemesters] = useState('');
  const [profileLoaded, setProfileLoaded] = useState(false);

  const [selectedTags, setSelectedTags] = useState(new Set());
  const [tagGroups, setTagGroups] = useState([]);
  const [preferredTrack, setPreferredTrack] = useState('');
  const [selectedInterests, setSelectedInterests] = useState(new Set());
  // 修課路徑與主題選項（PR #27 拿掉後於 2026-10-26 依使用者要求恢復）。
  // 課程主題改成三組（本系、通識、系外），選項是這位學生候選課程的類別（2026-11-20）。
  const [interestOptions, setInterestOptions] = useState({ tracks: [], topicGroups: [] });
  const [interestOptionsLoading, setInterestOptionsLoading] = useState(false);
  const [interestOptionsError, setInterestOptionsError] = useState(false);
  const [customInterests, setCustomInterests] = useState('');
  // 課程主題的選擇結果：[{ group, categoryId, level, mode, tagIds }]，以 (group, categoryId) 為鍵。
  // 通識與系外都有「語言」時各自一筆，取消其中一組不影響另一組。
  const [topicSelections, setTopicSelections] = useState([]);
  // 已保存或在本次表單確認過的選擇，可主動再次調整。
  const [reviewedSelectionKeys, setReviewedSelectionKeys] = useState(new Set());
  const [followupDialog, setFollowupDialog] = useState(null);
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
        setRemainingSemesters(profile.remainingSemesters ? String(profile.remainingSemesters) : '');
        if (profile.className) setClassName(profile.className);
        if (profile.mbti) setMbti(profile.mbti);
        setProgramType(profile.programType || '');
        setCollege(profile.college || '');
        setEnrolledPrograms((profile.enrolledPrograms || []).join('、'));
        setAvoidInstructors((profile.avoidInstructors || []).join('、'));

        if (Array.isArray(profile.selectedTags)) {
          setSelectedTags(new Set(profile.selectedTags));
        }
        setPreferredTrack(profile.preferredTrack || '');
        const savedSelections = Array.isArray(profile.interestSelections) ? profile.interestSelections : [];
        setTopicSelections(savedSelections);
        setReviewedSelectionKeys(new Set(savedSelections.map(item => followupKey(item.group, item.categoryId))));
        setSelectedInterests(new Set([
          ...(Array.isArray(profile.interests) ? profile.interests : []),
          ...(Array.isArray(profile.preferredKeywords) ? profile.preferredKeywords : []),
        ]));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setProfileLoaded(true);
      });

    return () => { cancelled = true; };
  }, [userIdentity]);

  useEffect(() => {
    let cancelled = false;
    setInterestOptionsLoading(true);

    coursesAPI.getInterestOptions(department, gradeLevel, className)
      .then(data => {
        if (!cancelled) {
          setInterestOptions({ tracks: data.tracks || [], topicGroups: data.topicGroups || [] });
          setInterestOptionsError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInterestOptions({ tracks: [], topicGroups: [] });
          setInterestOptionsError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setInterestOptionsLoading(false);
      });

    return () => { cancelled = true; };
  }, [department, gradeLevel, className]);

  // 這個選項（或它併進來的別名）目前是否已被選。
  const matchesOption = (selection, group, option) => (
    selection.group === group
    && (selection.categoryId === option.id || (option.aliasIds ?? []).includes(selection.categoryId))
  );
  const findSelection = (group, option) => topicSelections.find(item => matchesOption(item, group, option));

  const toggleTopic = (group, option) => {
    const current = findSelection(group, option);
    if (current) {
      setReviewedSelectionKeys(previous => {
        const next = new Set(previous);
        next.delete(followupKey(current.group, current.categoryId));
        return next;
      });
    }
    setTopicSelections(prev => {
      if (prev.some(item => matchesOption(item, group, option))) {
        // 只撤掉這一組這一個類別；別組同名的類別與共享的標籤不受影響。
        return prev.filter(item => !matchesOption(item, group, option));
      }
      return [...prev, {
        group,
        categoryId: option.id,
        level: option.level,
        mode: option.mode,
        // direct 選項列出命中的細項；followup 選項讓使用者另選細項。
        tagIds: option.mode === 'direct' ? (option.tags ?? []).map(tag => tag.tagId) : [],
      }];
    });
  };

  const toggleDirectTag = (selection, tagId) => {
    setTopicSelections(prev => prev.map(item => {
      if (item.group !== selection.group || item.categoryId !== selection.categoryId) return item;
      const has = item.tagIds.includes(tagId);
      return { ...item, tagIds: has ? item.tagIds.filter(id => id !== tagId) : [...item.tagIds, tagId] };
    }));
  };

  // 已保存、但不在目前選單裡的選擇（選單換了、候選池變了）：不顯示原始 ID，只提示並可整批移除。
  const allOptions = interestOptions.topicGroups.flatMap(group => group.options.map(option => ({ group: group.key, option })));
  const orphanSelections = topicSelections.filter(selection => (
    !allOptions.some(({ group, option }) => matchesOption(selection, group, option))
  ));

  const toggleInterest = (interest) => {
    setSelectedInterests(prev => {
      const next = new Set(prev);
      if (next.has(interest)) next.delete(interest);
      else next.add(interest);
      return next;
    });
  };

  const toggleTag = (tag) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  // 對話框的預設勾選以頁面上目前的答案為準，不能只靠伺服器的 `previouslySelected`：
  // 後者只知道「已保存」的選擇，在「調整」選好、還沒保存就重開時，剛選的會全部不見，
  // 這時按「確定」還會把它們清成 0 個（2026-11-20 瀏覽器驗收發現）。
  const currentTagIdsFor = (selections) => Object.fromEntries(selections.flatMap(({ group, categoryId }) => {
    const current = topicSelections.find(item => item.group === group && item.categoryId === categoryId);
    return current ? [[followupKey(group, categoryId), current.tagIds ?? []]] : [];
  }));

  const pendingTopics = topicSelections.filter(item => (
    item.mode === 'followup' && !reviewedSelectionKeys.has(followupKey(item.group, item.categoryId))
  ));
  const canAskAboutTopics = Boolean(department && Number(gradeLevel) > 0 && className);

  const openFollowup = (mode, selections) => {
    setFollowupDialog({
      mode,
      request: {
        department,
        gradeLevel: Number(gradeLevel),
        className,
        selections: selections.map(({ group, categoryId }) => ({ group, categoryId })),
      },
      initialTagIds: currentTagIdsFor(selections),
    });
  };

  const continueSetup = () => {
    if (setupStep === 1 && pendingTopics.length && canAskAboutTopics) {
      openFollowup('step', pendingTopics);
      return;
    }
    goToStep(setupStep + 1);
  };

  const handleSubmit = () => {
    if (userIdentity === null) {
      setSaveError('尚未登入，請重新登入後再保存偏好。');
      return;
    }
    if (pendingTopics.length && canAskAboutTopics) {
      openFollowup('save', pendingTopics);
      return;
    }
    persist(topicSelections);
  };

  const closeFollowup = (selections, reviewedKeys) => {
    const mode = followupDialog.mode;
    setReviewedSelectionKeys(previous => new Set([...previous, ...reviewedKeys]));
    setFollowupDialog(null);
    if (mode === 'step') goToStep(2);
    if (mode === 'save') persist(selections);
  };

  const applyFollowupAnswers = (answers) => {
    const next = topicSelections.map(item => {
      const answer = answers[followupKey(item.group, item.categoryId)];
      return answer ? { ...item, tagIds: answer } : item;
    });
    setTopicSelections(next);
    const keys = followupDialog.request.selections.map(item => followupKey(item.group, item.categoryId));
    closeFollowup(next, keys);
  };

  const skipFollowup = () => {
    const keys = followupDialog.request.selections.map(item => followupKey(item.group, item.categoryId));
    closeFollowup(topicSelections, keys);
  };

  const openFollowupEditor = (selection) => {
    if (canAskAboutTopics) openFollowup('edit', [selection]);
  };

  const finishAfterSave = (wasSetupDone) => {
    if (!wasSetupDone) {
      const exploration = getInterestExplorationState(userIdentity);
      if (exploration.status !== 'completed' && exploration.status !== 'skipped') {
        if (exploration.status !== 'in_progress') startInterestExploration(userIdentity);
        navigate('/interest-exploration', { replace: true });
        return;
      }
      navigate('/', { replace: true });
      return;
    }
    navigate(exploration.status === 'in_progress' ? '/interest-exploration' : '/');
  };

  const persist = async (selections) => {
    const wasSetupDone = isSetupDone();
    setSaveError('');
    setGenerating(true);
    try {
      const prefData = {
        department,
        gradeLevel: Number(gradeLevel),
        remainingSemesters: remainingSemesters ? Number(remainingSemesters) : null,
        className,
        mbti,
        programType: programType || null,
        college: college || null,
        enrolledPrograms: enrolledPrograms.split(/[、,，]/).map(value => value.trim()).filter(Boolean),
        avoidInstructors: avoidInstructors.split(/[、,，]/).map(value => value.trim()).filter(Boolean),
        selectedTags: [...selectedTags],
        preferredTrack: preferredTrack || null,
        interests: [...new Set([
          ...selectedInterests,
          ...customInterests
            .split(/[、,，]/)
            .map(value => value.trim())
            .filter(Boolean),
        ])],
        interestSelections: selections.map(({ group, categoryId, level, mode, tagIds }) => ({
          group, categoryId, level, mode, tagIds,
        })),
      };
      // 1. 儲存個人偏好設定（回應帶課程主題選擇的驗證狀態，下面據此決定要不要顯示提示）
      const result = await profileAPI.update(prefData);

      // 首次課表由首頁在探索結束後產生。既有帳號仍即時套用新設定。
      if (wasSetupDone && exploration.status !== 'in_progress') {
        try {
          await scheduleAPI.generate({ tags: [...selectedTags] });
        } catch (genErr) {
          console.warn('自動生成課表失敗，但偏好已儲存：', genErr);
        }
      }

      markSetupDone();
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
          {editing ? (exploration.status === 'in_progress' ? '返回探索' : '返回首頁') : '返回資料使用設定'}
        </PreferenceBackButton>
        {!editing && <PreferenceJourneySteps current={2} />}

        <header className="preference-page-header">
          <h1>{editing ? '調整排課偏好' : '設定你的排課偏好'}</h1>
          <p>{editing ? '直接選擇要修改的區塊，完成後保存。' : '先確認基本資料，再選課程興趣和排課條件。'}</p>
        </header>

        {generating ? (
          <div className="setup-generating">
            <div className="setup-generating-spinner">
              <Loader2 size={48} className="spin-animation" />
            </div>
            <h2>{editing && exploration.status !== 'in_progress' ? '正在保存偏好並更新課表…' : '正在保存偏好…'}</h2>
          </div>
        ) : (
          <div className="setup-content">
            <nav className="setup-journey-sections" aria-label="偏好設定區塊">
              {sections.map((section, index) => (
                <button type="button" key={section}
                  aria-current={index === setupStep ? 'step' : undefined}
                  onClick={() => goToStep(index)}
                  disabled={!profileLoaded || (!editing && index > setupStep)}>
                  {section}
                </button>
              ))}
            </nav>
            {setupStep === 0 && (
              <div className="setup-section-box" style={{ background: 'var(--bg-secondary, #f9fafb)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, #e5e7eb)' }}>
                <h3 className="setup-section-title" style={{ marginBottom: '16px', fontSize: '1.05rem', fontWeight: '600' }}>確認基本資料</h3>
                <p className="setup-student-scope" role="status">{profileLoaded
                  ? [department, gradeLevel ? gradeLevel + ' 年級' : '', className].filter(Boolean).join(' · ') || '尚無基本資料'
                  : '正在讀取基本資料…'}</p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label htmlFor="setup-mbti" style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-secondary)', margin: 0 }}>MBTI 人格特質：</label>
                    <select id="setup-mbti" value={mbti} onChange={e => setMbti(e.target.value)} style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #ccc', width: '100px', fontSize: '0.9rem' }}>
                      {['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'].map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label htmlFor="setup-remaining-semesters" style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-secondary)', margin: 0 }}>剩餘學期數（包含當學期）：</label>
                    <select
                      id="setup-remaining-semesters"
                      value={remainingSemesters}
                      onChange={e => setRemainingSemesters(e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.9rem' }}
                    >
                      <option value="">依年級自動推算</option>
                      {Array.from({ length: 8 }, (_, index) => index + 1).map(value => (
                        <option key={value} value={value}>剩餘 {value} 學期</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '12px 0 0 0' }}>系所、年級與班級由登入資料帶入。{profileLoaded && !className && '目前沒有班別資料，課程主題選項可能無法顯示。'}</p>
              </div>

            )}

            {setupStep === 1 && (
              <div className="setup-topic-section">
                <div className="setup-section-box history-feedback-setup" id="history-feedback">
                  <div>
                    <h3 className="setup-section-title">我修過的課</h3>
                    <p>告訴系統你修過的選修、通識與系外課喜不喜歡，推薦會參考主題相近的課（必修不列入）。</p>
                    {!personalizationGranted && <p className="history-feedback-hint">需要先在隱私設定同意「從互動持續改善個人化」。</p>}
                    {historyMessage && <p className="history-feedback-hint">{historyMessage}</p>}
                  </div>
                  <button type="button" className="course-card-action" onClick={openHistoryFeedback} disabled={!personalizationGranted || historyLoading}>
                    {historyLoading ? '載入中…' : '調整喜好'}
                  </button>
                </div>

                <div className="setup-pref-group" id="interest-preferences" style={{ marginBottom: '20px' }}>
                  <h4 className="setup-pref-category" style={{ fontSize: '0.95rem', marginBottom: '6px', color: 'var(--text-primary, #1f2937)' }}>
                    感興趣的課程方向
                  </h4>
                  <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 12px' }}>
                    選擇想深入的方向，系統會參考課程主題調整推薦排序；這是偏好，不會排除其他必修課。
                  </p>

                  {interestOptions.tracks.length > 0 && (
                    <div style={{ marginBottom: '14px' }}>
                      <h5 className="setup-pref-category" style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
                        主要修課路徑（單選）
                      </h5>
                      <div className="setup-pref-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {interestOptions.tracks.map(track => (
                          <button
                            type="button"
                            key={track}
                            className={`setup-tag ${preferredTrack === track ? 'selected' : ''}`}
                            onClick={() => setPreferredTrack(prev => prev === track ? '' : track)}
                            aria-pressed={preferredTrack === track}
                            id={`interest-track-${track}`}
                            style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '999px' }}
                          >
                            {track}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: '12px' }} id="interest-topic-groups">
                    <h5 className="setup-pref-category" style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
                      想接觸的課程主題（可複選）
                    </h5>
                    <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 10px' }}>
                      勾選類別後，可以立刻選擇細項，也可以在進入排課條件前一次確認。
                    </p>
                    {interestOptionsLoading ? (
                      <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>正在整理目前可選課程的主題…</p>
                    ) : interestOptionsError ? (
                      <p style={{ fontSize: '0.8rem', color: '#b45309' }}>暫時無法載入興趣選項，請稍後再試。</p>
                    ) : interestOptions.topicGroups.length > 0 ? (
                      interestOptions.topicGroups.map(group => (
                        <div key={group.key} className="interest-topic-group" id={`interest-group-${group.key}`} style={{ marginBottom: '12px' }}>
                          <h6 className="interest-topic-group-label">{group.label}</h6>
                          <div className="setup-pref-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {group.options.map(option => {
                              const selected = Boolean(findSelection(group.key, option));
                              return (
                                <button
                                  type="button"
                                  key={option.id}
                                  className={`setup-tag ${selected ? 'selected' : ''}`}
                                  onClick={() => toggleTopic(group.key, option)}
                                  aria-pressed={selected}
                                  id={`interest-topic-${group.key}-${option.id}`}
                                  title={`${option.courseCount} 門候選課程、${option.tagCount} 個可選主題；例如：${(option.sampleCourses ?? []).join('、')}`}
                                  style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '999px' }}
                                >
                                  {option.name}
                                </button>
                              );
                            })}
                          </div>

                          {/* 已勾選的選項：direct 顯示展開的標籤供確認；已保存過的 followup 顯示已選幾個，可調整。 */}
                          {group.options.map(option => {
                            const selection = findSelection(group.key, option);
                            if (!selection) return null;
                            if (selection.mode === 'direct') {
                              return (
                                <div key={`confirm-${option.id}`} className="interest-topic-confirm" id={`interest-confirm-${option.id}`}>
                                  <p>「{option.name}」會加分給下面這些主題的課，不要的可以取消：</p>
                                  {(option.tags ?? []).map(tag => (
                                    <label key={tag.tagId} className="interest-topic-confirm-row">
                                      <input
                                        type="checkbox"
                                        checked={selection.tagIds.includes(tag.tagId)}
                                        onChange={() => toggleDirectTag(selection, tag.tagId)}
                                      />
                                      <span className="interest-followup-option-name">{tag.name}</span>
                                      <span className="interest-followup-option-meta">
                                        {tag.courseCount} 門課，例如：{(tag.sampleCourses ?? []).join('、')}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              );
                            }
                            return (
                              <p key={`answered-${option.id}`} className="interest-topic-answered">
                                「{option.name}」{reviewedSelectionKeys.has(followupKey(selection.group, selection.categoryId))
                                  ? '已選 ' + selection.tagIds.length + ' 個具體主題'
                                  : '可再選擇具體主題'}
                                <button type="button" disabled={!canAskAboutTopics} onClick={() => openFollowupEditor(selection)} id={`interest-edit-${option.id}`}>
                                  {reviewedSelectionKeys.has(followupKey(selection.group, selection.categoryId)) ? '調整' : '選擇細項'}
                                </button>
                              </p>
                            );
                          })}
                        </div>
                      ))
                    ) : (
                      <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                        {className ? '目前候選課程沒有可用的主題標籤。' : '選好班別後會顯示目前候選課程的主題。'}
                      </p>
                    )}

                    {orphanSelections.length > 0 && (
                      <p className="interest-topic-answered" id="interest-orphans">
                        另有 {orphanSelections.length} 個先前保存的主題選擇，目前不在選單內（候選課程已更新），仍然有效。
                        <button
                          type="button"
                          onClick={() => setTopicSelections(prev => prev.filter(item => !orphanSelections.includes(item)))}
                        >
                          移除
                        </button>
                      </p>
                    )}

                  </div>

                  <details className="setup-other-interests" id="interest-keywords">
                    <summary>
                      其他興趣{selectedInterests.size > 0 && <span>（{selectedInterests.size} 個已保存關鍵字）</span>}
                    </summary>
                    <p>可以補充上方沒列到的興趣。點選已保存的關鍵字即可移除。</p>
                    {selectedInterests.size > 0 && (
                      <div className="setup-pref-tags">
                          {[...selectedInterests].map(topic => (
                            <button
                              type="button"
                              key={topic}
                              className="setup-tag selected"
                              onClick={() => toggleInterest(topic)}
                              aria-pressed="true"
                              id={`interest-keyword-${topic}`}
                              style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '999px' }}
                            >
                              {topic}
                            </button>
                          ))}
                      </div>
                    )}
                    <label htmlFor="setup-custom-interests">補充興趣關鍵字</label>
                    <input
                      id="setup-custom-interests"
                      value={customInterests}
                      onChange={event => setCustomInterests(event.target.value)}
                      placeholder="例如：生成式 AI、雲端；多筆以頓號分隔"
                    />
                  </details>
                  <button
                    type="button"
                    onClick={() => {
                      setPreferredTrack('');
                      setSelectedInterests(new Set());
                      setCustomInterests('');
                      setTopicSelections([]);
                      setReviewedSelectionKeys(new Set());
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
                <div className="setup-journey-review">
                  <span>修課路徑：{preferredTrack || '尚未指定'}</span>
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
            {saveError && <p className="setup-error" role="alert">{saveError}</p>}
            <div className="setup-journey-actions">
              {!editing && setupStep > 0 && (
                <button type="button" className="course-card-action" onClick={() => goToStep(setupStep - 1)}>上一步</button>
              )}
              {!editing && setupStep < 2 ? (
                <button type="button" className="course-card-action primary" onClick={continueSetup} disabled={!profileLoaded}>
                  {setupStep === 0 ? '繼續選課程興趣' : '繼續設定排課條件'} <ArrowRight size={17} />
                </button>
              ) : (
                <button type="button" className="course-card-action primary" onClick={handleSubmit} disabled={!profileLoaded}>
                  {editing ? (exploration.status === 'in_progress' ? '保存並繼續探索' : '保存變更') : '保存並前往探索'} <ArrowRight size={17} />
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
      {followupDialog && (
        <InterestFollowupDialog
          request={followupDialog.request}
          mode={followupDialog.mode}
          initialTagIds={followupDialog.initialTagIds}
          onConfirm={applyFollowupAnswers}
          onSkip={skipFollowup}
          onCancel={() => setFollowupDialog(null)}
        />
      )}
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
