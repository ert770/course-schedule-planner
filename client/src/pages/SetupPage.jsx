import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { profileAPI, historyFeedbackAPI, coursesAPI, scheduleAPI } from '../services/api';
import HistoryFeedbackModal from '../components/Profile/HistoryFeedbackModal';
import InterestFollowupDialog from '../components/Profile/InterestFollowupDialog';
import { followupKey } from '../utils/interestSelections';
import { Sparkles, CheckCircle2, Circle, Loader2, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react'; 
import { getUserIdentity } from '../utils/userIdentity';
import {
  getInterestExplorationState,
  startInterestExploration,
} from '../services/interestExplorationState';

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
  // 已經保存過的選擇：這些不需要再追問，要改答案用「調整」。
  const [savedSelectionKeys, setSavedSelectionKeys] = useState(new Set());
  // 追問對話框：null 或 { mode: 'save' | 'edit', request }。
  const [followupDialog, setFollowupDialog] = useState(null);
  // 保存成功但有主題標籤沒能保存時，先讓使用者看到說明再離開。
  const [saveNotice, setSaveNotice] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [showPreferencesModal, setShowPreferencesModal] = useState(false);

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
        setSavedSelectionKeys(new Set(savedSelections.map(item => followupKey(item.group, item.categoryId))));
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
        // direct：小而一致的子類別，直接展開候選池裡實際命中的標籤，顯示給學生確認；followup：保存時追問。
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

  // 按下「完成並保存偏好設定」：有新勾的 followup 類別就先追問，沒有就直接保存。
  const handleSubmit = () => {
    if (userIdentity === null) {
      alert('尚未登入，無法儲存個人偏好設定。請重新登入後再試。');
      return;
    }
    const pending = topicSelections.filter(item => (
      item.mode === 'followup' && !savedSelectionKeys.has(followupKey(item.group, item.categoryId))
    ));
    // 追問需要完整的學生範圍（系所、年級、班別）；缺班別時不追問，只記錄類別。
    if (pending.length > 0 && department && Number(gradeLevel) > 0 && className) {
      setFollowupDialog({
        mode: 'save',
        request: {
          department,
          gradeLevel: Number(gradeLevel),
          className,
          selections: pending.map(({ group, categoryId }) => ({ group, categoryId })),
        },
        // 保存失敗後再按保存，已答但未存的類別仍算「新勾」，要帶回剛才的答案。
        initialTagIds: currentTagIdsFor(pending),
      });
      return;
    }
    persist(topicSelections);
  };

  // 追問對話框「確定」：把答案放進對應的選擇。保存模式接著保存，調整模式只更新畫面。
  const applyFollowupAnswers = (answers) => {
    const next = topicSelections.map(item => {
      const answer = answers[followupKey(item.group, item.categoryId)];
      return answer ? { ...item, tagIds: answer } : item;
    });
    setTopicSelections(next);
    const mode = followupDialog?.mode;
    setFollowupDialog(null);
    if (mode === 'save') persist(next);
  };

  const skipFollowup = () => {
    // 略過：新勾的類別只記類別（沒有標籤），已確認的答案保留。
    setFollowupDialog(null);
    persist(topicSelections);
  };

  const openFollowupEditor = (selection) => {
    if (!department || !(Number(gradeLevel) > 0) || !className) return;
    setFollowupDialog({
      mode: 'edit',
      request: {
        department,
        gradeLevel: Number(gradeLevel),
        className,
        selections: [{ group: selection.group, categoryId: selection.categoryId }],
      },
      initialTagIds: currentTagIdsFor([selection]),
    });
  };

  const finishAfterSave = (wasSetupDone) => {
    if (!wasSetupDone) {
      const exploration = getInterestExplorationState(userIdentity);
      if (exploration.status !== 'completed' && exploration.status !== 'skipped') {
        startInterestExploration(userIdentity);
        navigate('/interest-exploration', { replace: true });
        return;
      }
      navigate('/', { replace: true });
      return;
    }
    navigate('/');
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

      // 2. 儲存偏好後立刻觸發排課生成 API，確保首頁課表即時套用最新條件（例如星期一排空等）
      try {
        await scheduleAPI.generate({
          tags: [...selectedTags],
        });
      } catch (genErr) {
        console.warn('自動生成課表失敗，但偏好已儲存：', genErr);
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

  // 已設定過的使用者重新打開興趣卡面（PR #27 拿掉後於 2026-10-26 恢復）。
  const reopenInterestExploration = () => {
    if (userIdentity === null) return;
    startInterestExploration(userIdentity);
    navigate('/interest-exploration');
  };

  return (
    <div className="setup-page" id="setup-page">
      <div className="setup-card animate-fadeInUp" style={{ position: 'relative', maxWidth: '850px', width: '100%' }}>
        
        <button 
          // 已設定過的使用者從選單進來調整偏好，返回首頁；第一次的引導流程才返回同意頁。
          onClick={() => navigate(isSetupDone() ? '/' : '/onboarding')}
          style={{
            position: 'absolute', top: '16px', left: '16px',
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '8px', borderRadius: '50%', transition: 'background 0.2s', zIndex: 10
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#f1f5f9'}
          onMouseOut={(e) => e.currentTarget.style.background = 'none'}
          title={isSetupDone() ? '返回首頁' : '返回上一步'}
        >
          <ArrowLeft size={22} />
        </button>

        {generating ? (
          <div className="setup-generating">
            <div className="setup-generating-spinner">
              <Loader2 size={48} className="spin-animation" />
            </div>
            <h2>正在保存你的偏好設定並生成課表…</h2>
            <p>保存完成後，將自動套用您的排課偏好</p>
          </div>
        ) : (
          <div className="setup-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingTop: '20px' }}>

            <div className="setup-section-box" style={{ background: 'var(--bg-secondary, #f9fafb)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, #e5e7eb)' }}>
              <h3 className="setup-section-title" style={{ marginBottom: '16px', fontSize: '1.05rem', fontWeight: '600' }}>1. 基本資料與人格特質</h3>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-secondary)', margin: 0 }}>MBTI 人格特質：</label>
                  <select value={mbti} onChange={e => setMbti(e.target.value)} style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #ccc', width: '100px', fontSize: '0.9rem' }}>
                    {['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'].map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-secondary)', margin: 0 }}>剩餘學期數（包含當學期）：</label>
                  <select
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
              <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '12px 0 0 0' }}>（系所、年級與班級資料將自動由系統帶入）</p>
            </div>

            <div className="setup-steps-box" style={{ background: 'var(--bg-secondary, #f9fafb)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-color, #e5e7eb)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-secondary)' }}>設定流程進度：</span>
              <div style={{ display: 'flex', gap: '30px', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '0.85rem' }}>
                  <CheckCircle2 size={16} /> <span>登入成功</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3b82f6', fontSize: '0.85rem', fontWeight: '600' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#3b82f6' }} /> <span>2. 偏好設定</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#9ca3af', fontSize: '0.85rem' }}>
                  <Circle size={16} /> <span>3. 主題探索與排課</span>
                </div>
              </div>
            </div>

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

            <div className="setup-preferences-box" style={{ background: 'var(--bg-secondary, #f9fafb)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, #e5e7eb)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowPreferencesModal(!showPreferencesModal)}>
                <div>
                  <h3 className="setup-section-title" style={{ fontSize: '1.05rem', fontWeight: '600', marginBottom: '4px' }}>2. 排課偏好與時段設定</h3>
                  <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>
                    已選擇 <strong style={{ color: '#3b82f6' }}>{selectedTags.size}</strong> 項排課偏好；
                    興趣方向{preferredTrack || selectedInterests.size > 0 || customInterests.trim() || topicSelections.length > 0 ? '已設定。' : '未設定。'}
                  </p>
                </div>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: '#3b82f6', fontWeight: '600', fontSize: '0.9rem' }}>
                  {showPreferencesModal ? '收合設定' : '展開詳細設定'} {showPreferencesModal ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>

              {showPreferencesModal && (
                <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-color, #e5e7eb)', paddingTop: '16px', animation: 'fadeIn 0.3s ease' }}>
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
                        勾選類別後，按下方「完成並保存」時會再請你選具體的主題，系統才知道要優先推薦哪些課。
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
                              if (!savedSelectionKeys.has(followupKey(selection.group, selection.categoryId))) return null;
                              return (
                                <p key={`answered-${option.id}`} className="interest-topic-answered">
                                  「{option.name}」已選 {selection.tagIds.length} 個具體主題
                                  <button type="button" onClick={() => openFollowupEditor(selection)} id={`interest-edit-${option.id}`}>
                                    調整
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

                      {selectedInterests.size > 0 && (
                        <div style={{ marginTop: '10px' }} id="interest-keywords">
                          <h6 className="interest-topic-group-label">已設定的興趣關鍵字（點一下可移除）</h6>
                          <div className="setup-pref-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
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
                        </div>
                      )}
                    </div>

                    <input
                      value={customInterests}
                      onChange={event => setCustomInterests(event.target.value)}
                      placeholder="其他興趣，例如：生成式 AI、雲端；多筆以頓號分隔"
                      style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setPreferredTrack('');
                        setSelectedInterests(new Set());
                        setCustomInterests('');
                        setTopicSelections([]);
                      }}
                      style={{ marginTop: '8px', padding: 0, border: 'none', background: 'none', color: '#3b82f6', cursor: 'pointer' }}
                    >
                      目前沒有特定方向，先平均探索
                    </button>
                  </div>

                  {tagGroups.map(({ category, tags }) => (
                    <div key={category} className="setup-pref-group" style={{ marginBottom: '12px' }}>
                      <h4 className="setup-pref-category" style={{ fontSize: '0.85rem', marginBottom: '6px', color: 'var(--text-secondary)' }}>{category}</h4>
                      <div className="setup-pref-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {tags.map(tag => (
                          <button
                            key={tag}
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

                </div>
              )}
            </div>

          </div>
        )}

        {!generating && (
          <div className="setup-footer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
            {saveError && <p className="setup-error" role="alert" style={{ color: 'var(--accent-red)', margin: 0 }}>{saveError}</p>}
            <button
              className="setup-submit-btn"
              onClick={handleSubmit}
              disabled={!profileLoaded}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', fontSize: '1rem', fontWeight: '600' }}
            >
              <Sparkles size={18} />
              {profileLoaded ? '完成並保存偏好設定 ✨' : '載入設定中...'}
            </button>

            {profileLoaded && isSetupDone() && (
              <button
                type="button"
                onClick={reopenInterestExploration}
                id="setup-reopen-exploration"
                style={{ padding: '7px 0', border: 'none', background: 'transparent', color: '#3b82f6', cursor: 'pointer', fontSize: '0.88rem' }}
              >
                重新探索課程主題
              </button>
            )}
          </div>
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