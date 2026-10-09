import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { coursesAPI, profileAPI } from '../services/api';
import { Sparkles, CheckCircle2, Circle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { getUserIdentity } from '../utils/userIdentity';
import {
  getInterestExplorationState,
  startInterestExploration,
} from '../services/interestExplorationState';

export default function SetupPage() {
  const navigate = useNavigate();
  const { user, markSetupDone, isSetupDone, logout } = useAuth();
  const userIdentity = getUserIdentity(user);
  
  const [department, setDepartment] = useState('資訊工程學系');
  const [gradeLevel, setGradeLevel] = useState('1');
  const [remainingSemesters, setRemainingSemesters] = useState('');
  const [programType, setProgramType] = useState('');
  const [college, setCollege] = useState('');
  const [enrolledPrograms, setEnrolledPrograms] = useState('');
  const [avoidInstructors, setAvoidInstructors] = useState('');
  const [mbti, setMbti] = useState('INTJ');
  const [className, setClassName] = useState('');
  const [classOptions, setClassOptions] = useState([]);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const [selectedTags, setSelectedTags] = useState(new Set());
  const [tagGroups, setTagGroups] = useState([]);
  const [preferredTrack, setPreferredTrack] = useState('');
  const [selectedInterests, setSelectedInterests] = useState(new Set());
  const [customInterests, setCustomInterests] = useState('');
  const [interestOptions, setInterestOptions] = useState({ tracks: [], topics: [] });
  const [interestOptionsLoading, setInterestOptionsLoading] = useState(false);
  const [interestOptionsError, setInterestOptionsError] = useState(false);
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
    coursesAPI.getClasses(department, gradeLevel, programType)
      .then(data => {
        if (cancelled) return;
        const classes = data.classes || [];
        setClassOptions(classes);
        setClassName(prev => (classes.includes(prev) ? prev : ''));
      })
      .catch(() => {
        if (!cancelled) setClassOptions([]);
      });
    return () => { cancelled = true; };
  }, [department, gradeLevel, programType]);

  useEffect(() => {
    let cancelled = false;
    setInterestOptionsLoading(true);

    coursesAPI.getInterestOptions(department, gradeLevel, className)
      .then(data => {
        if (!cancelled) {
          setInterestOptions({ tracks: data.tracks || [], topics: data.topics || [] });
          setInterestOptionsError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInterestOptions({ tracks: [], topics: [] });
          setInterestOptionsError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setInterestOptionsLoading(false);
      });

    return () => { cancelled = true; };
  }, [department, gradeLevel, className]);

  const toggleTag = (tag) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const toggleInterest = (interest) => {
    setSelectedInterests(prev => {
      const next = new Set(prev);
      if (next.has(interest)) next.delete(interest);
      else next.add(interest);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (userIdentity === null) {
      alert('尚未登入，無法儲存個人偏好設定。請重新登入後再試。');
      return;
    }

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
      };
      await profileAPI.update(prefData);
      markSetupDone();
      if (!wasSetupDone) {
        const exploration = getInterestExplorationState(userIdentity);
        if (exploration.status !== 'completed' && exploration.status !== 'skipped') {
          startInterestExploration(userIdentity);
          navigate('/interest-exploration', { replace: true });
          return;
        }
        navigate('/schedule', { replace: true });
        return;
      }
      navigate('/');
    } catch (err) {
      console.error('Setup failed:', err);
      setSaveError(err.message || '偏好設定儲存失敗，請稍後重試。');
    } finally {
      setGenerating(false);
    }
  };

  const reopenInterestExploration = () => {
    if (userIdentity === null) return;
    startInterestExploration(userIdentity);
    navigate('/interest-exploration');
  };

  return (
    <div className="setup-page" id="setup-page">
      <div className="setup-card animate-fadeInUp" style={{ maxWidth: '850px', width: '100%' }}>
        {generating ? (
        <div className="setup-generating">
            <div className="setup-generating-spinner">
              <Loader2 size={48} className="spin-animation" />
            </div>
            <h2>正在保存你的偏好設定…</h2>
            <p>保存完成後，會接著進入初始課程主題探索</p>
          </div>
        ) : (
          <div className="setup-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* 1. 基本資料與人格特質 */}
            <div className="setup-section-box" style={{ background: 'var(--bg-secondary, #f9fafb)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, #e5e7eb)' }}>
              <h3 className="setup-section-title" style={{ marginBottom: '16px', fontSize: '1.05rem', fontWeight: '600' }}>1. 基本資料與人格特質</h3>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
                <select value={department} onChange={e => setDepartment(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}>
                  <option value="資訊工程學系">資訊工程學系</option>
                  <option value="電機工程學系">電機工程學系</option>
                  <option value="企業管理學系">企業管理學系</option>
                </select>
                <select value={gradeLevel} onChange={e => setGradeLevel(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}>
                  <option value="1">大一</option>
                  <option value="2">大二</option>
                  <option value="3">大三</option>
                  <option value="4">大四</option>
                  <option value="5">研究所</option>
                </select>
                <select
                  value={className}
                  onChange={e => setClassName(e.target.value)}
                  disabled={classOptions.length === 0}
                  style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                  id="setup-class-select"
                >
                  <option value="">未指定班別</option>
                  {classOptions.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-secondary)' }}>MBTI 人格特質：</label>
                <select value={mbti} onChange={e => setMbti(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc', width: '140px' }}>
                  {['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'].map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>（用於優化學習風格推薦）</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                <select
                  value={programType}
                  onChange={e => {
                    const next = e.target.value;
                    setProgramType(next);
                    if (next === 'master' || next === 'doctoral') setGradeLevel('5');
                    else if (gradeLevel === '5') setGradeLevel('1');
                  }}
                  aria-label="學制"
                  style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                >
                  <option value="">學制未確認</option>
                  <option value="bachelor">學士</option>
                  <option value="master">碩士</option>
                  <option value="doctoral">博士</option>
                </select>
                <input value={college} onChange={e => setCollege(e.target.value)} placeholder="學院（例：資訊電機學院）" style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                <input value={enrolledPrograms} onChange={e => setEnrolledPrograms(e.target.value)} placeholder="學程，多筆以頓號分隔" style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                <input value={avoidInstructors} onChange={e => setAvoidInstructors(e.target.value)} placeholder="避開教師，多筆以頓號分隔" style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                <select
                  value={remainingSemesters}
                  onChange={e => setRemainingSemesters(e.target.value)}
                  aria-label="剩餘學期數"
                  style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                >
                  <option value="">剩餘學期：依年級推算</option>
                  {Array.from({ length: 8 }, (_, index) => index + 1).map(value => (
                    <option key={value} value={value}>剩餘 {value} 學期</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 2. 設定流程進度（改為 100% 寬度對齊） */}
            <div className="setup-steps-box" style={{ background: 'var(--bg-secondary, #f9fafb)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-color, #e5e7eb)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-secondary)' }}>設定流程進度：</span>
              <div style={{ display: 'flex', gap: '30px', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '0.85rem' }}>
                  <CheckCircle2 size={16} /> <span>1. 登入成功</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3b82f6', fontSize: '0.85rem', fontWeight: '600' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#3b82f6' }} /> <span>2. 偏好設定</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#9ca3af', fontSize: '0.85rem' }}>
                  <Circle size={16} /> <span>3. 主題探索與排課</span>
                </div>
              </div>
            </div>

            {/* 3. 排課偏好設定（濃縮收合版） */}
            <div className="setup-preferences-box" style={{ background: 'var(--bg-secondary, #f9fafb)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, #e5e7eb)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowPreferencesModal(!showPreferencesModal)}>
                <div>
                  <h3 className="setup-section-title" style={{ fontSize: '1.05rem', fontWeight: '600', marginBottom: '4px' }}>2. 排課偏好與時段設定</h3>
                  <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>
                    已選擇 <strong style={{ color: '#3b82f6' }}>{selectedTags.size}</strong> 項排課偏好；
                    興趣方向{preferredTrack || selectedInterests.size > 0 || customInterests.trim() ? '已設定。' : '未設定。'}
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

                    <div style={{ marginBottom: '12px' }}>
                      <h5 className="setup-pref-category" style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
                        想接觸的課程主題（可複選）
                      </h5>
                      {interestOptionsLoading ? (
                        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>正在整理目前可選課程的主題…</p>
                      ) : interestOptionsError ? (
                        <p style={{ fontSize: '0.8rem', color: '#b45309' }}>暫時無法載入興趣選項，請稍後再試。</p>
                      ) : interestOptions.topics.length > 0 ? (
                        <div className="setup-pref-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {[...new Set([
                            ...interestOptions.topics.map(topic => topic.name),
                            ...selectedInterests,
                          ])].map(topic => (
                            <button
                              type="button"
                              key={topic}
                              className={`setup-tag ${selectedInterests.has(topic) ? 'selected' : ''}`}
                              onClick={() => toggleInterest(topic)}
                              aria-pressed={selectedInterests.has(topic)}
                              id={`interest-topic-${topic}`}
                              title={interestOptions.topics.find(option => option.name === topic)?.courseCount
                                ? `目前有 ${interestOptions.topics.find(option => option.name === topic).courseCount} 門候選課程`
                                : undefined}
                              style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '999px' }}
                            >
                              {topic}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                          {className ? '目前候選課程沒有可用的主題標籤。' : '選好班別後會顯示目前候選課程的主題。'}
                        </p>
                      )}
                    </div>

                    <input
                      value={customInterests}
                      onChange={event => setCustomInterests(event.target.value)}
                      placeholder="其他興趣，例如：生成式 AI、雲端；多筆以頓號分隔"
                      aria-label="其他課程興趣"
                      style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setPreferredTrack('');
                        setSelectedInterests(new Set());
                        setCustomInterests('');
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
                            id={`tag-${tag.replace('#', '')}`}
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
              id="setup-submit-btn"
              style={{ width: '100%', padding: '12px', borderRadius: '8px', fontSize: '1rem', fontWeight: '600' }}
            >
              <Sparkles size={18} />
              {profileLoaded ? '完成並保存偏好設定 ✨' : '載入設定中...'}
            </button>

            {profileLoaded && isSetupDone() && (
              <button
                type="button"
                onClick={reopenInterestExploration}
                style={{ padding: '7px 0', border: 'none', background: 'transparent', color: '#3b82f6', cursor: 'pointer', fontSize: '0.88rem' }}
              >
                重新探索課程主題
              </button>
            )}
            
            <button 
              onClick={() => {
                logout();
                window.location.href = '/login';
              }}
              style={{
                background: 'transparent', border: 'none', 
                color: '#888', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline'
              }}
            >
              返回登入畫面 (重新測試)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
