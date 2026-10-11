import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { profileAPI } from '../services/api';
import { Sparkles, CheckCircle2, Circle, Loader2, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react'; 
import { getUserIdentity } from '../utils/userIdentity';
import {
  getInterestExplorationState,
  startInterestExploration,
} from '../services/interestExplorationState';

export default function SetupPage() {
  const navigate = useNavigate();
  // 【修正點】：將原本尾端的 , logout 移除了，解決 ESLint unused-vars 錯誤
  const { user, markSetupDone, isSetupDone } = useAuth();
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
  const [customInterests, setCustomInterests] = useState('');
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

  const toggleTag = (tag) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
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
        navigate('/', { replace: true });
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

  return (
    <div className="setup-page" id="setup-page">
      <div className="setup-card animate-fadeInUp" style={{ position: 'relative', maxWidth: '850px', width: '100%' }}>
        
        <button 
          onClick={() => navigate('/onboarding')}
          style={{
            position: 'absolute', top: '16px', left: '16px',
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '8px', borderRadius: '50%', transition: 'background 0.2s', zIndex: 10
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#f1f5f9'}
          onMouseOut={(e) => e.currentTarget.style.background = 'none'}
          title="返回上一步"
        >
          <ArrowLeft size={22} />
        </button>

        {generating ? (
          <div className="setup-generating">
            <div className="setup-generating-spinner">
              <Loader2 size={48} className="spin-animation" />
            </div>
            <h2>正在保存你的偏好設定…</h2>
            <p>保存完成後，會接著進入初始課程主題探索</p>
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
                  <label style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-secondary)', margin: 0 }}>剩餘學期數：</label>
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
          </div>
        )}
      </div>
    </div>
  );
}