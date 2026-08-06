import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { coursesAPI, profileAPI } from '../services/api';
import { Sparkles, CheckCircle2, Circle, Loader2 } from 'lucide-react';

const PREFERENCE_TAGS = {
  '上課時間': [
    '#盡量集中排課', '#不排早八', '#星期一排空', '#午休務必空出'
  ],
  '評量方式偏好': [
    '#無期中考', '#上機實作考試', '#期末報告為主', '#平時成績佔比高'
  ],
  '課程型態與互動': [
    '#無分組報告', '#高度課堂討論', '#全英授課', '#學到許多知識'
  ],
};

const CLASS_REQUIRED_MESSAGE = '缺少班級資料，請先匯入學生班級再搜尋課程。';

export default function SetupPage() {
  const navigate = useNavigate();
  const { user, markSetupDone } = useAuth();
  
  // Basic info
  //
  // 初始值只是等待 profile 載入前的暫時值。**真正的來源是 `GET /api/profile`**——
  // 登入回傳的 `user` 物件來自 `users.json`，它沒有 `className`，系所與年級也不是
  // 排課實際採用的那一份（見稽核報告 F16）。用它當預設值會讓使用者一進設定頁
  // 就看到與系統實際狀態不符的值，按下儲存後把正確的資料覆蓋掉。
  const [department, setDepartment] = useState('資訊工程學系');
  // 年級必須帶入使用者的實際年級。排課的必修範圍依系所與年級判定（#13），
  // 這裡若固定送出預設大一，三年級學生的設定會被存成大一，拿到的是大一必修。
  // 因此在 profile 載入完成前不開放送出（見 `profileLoaded`）。
  const [grade, setGrade] = useState('1');
  // 必修不得換班（資工系明文），因此必修範圍要收斂到班別而不只是系所與年級。
  // 班別清單向後端取得，不在前端複製一份系所簡稱對照表。
  const [className, setClassName] = useState('');
  const [classOptions, setClassOptions] = useState([]);
  const [courseSearchScope, setCourseSearchScope] = useState(null);
  const [electiveError, setElectiveError] = useState('');
  // profile 尚未載入完成前不得送出，否則會用暫時值覆蓋已儲存的設定。
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Electives
  const [electives, setElectives] = useState([]);
  const [checkedCourses, setCheckedCourses] = useState(new Set());
  
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadElectiveCourses = useCallback(async () => {
    if (!profileLoaded) return;
    if (!courseSearchScope?.className) {
      setElectives([]);
      setElectiveError(CLASS_REQUIRED_MESSAGE);
      return;
    }

    setLoading(true);
    setElectiveError('');
    try {
      const data = await coursesAPI.search({ ...courseSearchScope, category: '選修' });
      const courses = (data.courses || []).filter(c => c.category === '選修');
      setElectives(courses);
    } catch (err) {
      setElectives([]);
      setElectiveError(err.message || '選修課程載入失敗');
    } finally {
      setLoading(false);
    }
  }, [courseSearchScope, profileLoaded]);

  useEffect(() => {
    loadElectiveCourses();
  }, [loadElectiveCourses]);

  // 帶回已儲存的系所、年級與班別。沒有這一步，使用者只要進到設定頁按儲存，
  // 已存的班別就會被空值蓋掉——表單送出的是它自己的初始值，而初始值裡沒有班別。
  useEffect(() => {
    let cancelled = false;

    profileAPI.get(user?.studentId || 'default')
      .then(profile => {
        if (cancelled || !profile) return;
        if (profile.department) setDepartment(profile.department);
        const savedGrade = profile.gradeLevel ?? profile.grade;
        if (savedGrade) setGrade(String(savedGrade));
        if (profile.className) setClassName(profile.className);
        setCourseSearchScope(profile.courseSearchScope || null);
      })
      .catch(() => { /* 讀不到就沿用初始值，不阻斷設定流程 */ })
      .finally(() => {
        if (!cancelled) setProfileLoaded(true);
      });

    return () => { cancelled = true; };
  }, [user?.studentId]);

  useEffect(() => {
    let cancelled = false;

    coursesAPI.getClasses(department, grade)
      .then(data => {
        if (cancelled) return;
        const classes = data.classes || [];
        setClassOptions(classes);
        // 換系所或年級後，原本的班別已不適用，清掉而不是留著錯的值。
        setClassName(prev => (classes.includes(prev) ? prev : ''));
      })
      .catch(() => {
        if (!cancelled) setClassOptions([]);
      });

    return () => { cancelled = true; };
  }, [department, grade]);

  const toggleCourse = (id) => {
    setCheckedCourses(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  const handleSubmit = async () => {
    setGenerating(true);
    try {
      // Save preferences to backend
      const prefData = {
        department,
        grade,
        className,
        noMorningClasses: selectedTags.has('#不排早八'),
        preferCompact: selectedTags.has('#盡量集中排課'),
        mondayFree: selectedTags.has('#星期一排空'),
        lunchBreakFree: selectedTags.has('#午休務必空出'),
        noMidterm: selectedTags.has('#無期中考'),
        practicalExam: selectedTags.has('#上機實作考試'),
        finalReport: selectedTags.has('#期末報告為主'),
        weightDaily: selectedTags.has('#平時成績佔比高'),
        noGroupReport: selectedTags.has('#無分組報告'),
        preferDiscussion: selectedTags.has('#高度課堂討論'),
        englishTaught: selectedTags.has('#全英授課'),
        learnMore: selectedTags.has('#學到許多知識'),
        completedCourseIds: [...checkedCourses],
        selectedTags: [...selectedTags],
      };
      await profileAPI.update(prefData, user?.studentId || 'default');

      markSetupDone();

      // Ensure Dashboard generates a new schedule based on these exact prefs when mounted
      localStorage.setItem('fcu_initial_prefs', JSON.stringify(prefData));

      // Small delay for animation feel
      await new Promise(r => setTimeout(r, 1500));

      navigate('/');
    } catch (err) {
      console.error('Setup failed:', err);
      markSetupDone();
      navigate('/');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="setup-page" id="setup-page">
      <div className="setup-card animate-fadeInUp">
        {generating ? (
          <div className="setup-generating">
            <div className="setup-generating-spinner">
              <Loader2 size={48} className="spin-animation" />
            </div>
            <h2>🤖 Agent 正在呼叫排課演算法...</h2>
            <p>正在根據您的偏好生成最佳化課表</p>
          </div>
        ) : (
          <div className="setup-content">
            {/* Left - Steps */}
            <div className="setup-steps">
              <h2 className="setup-heading">使用者設定流程</h2>
              <div className="setup-step completed">
                <CheckCircle2 size={18} />
                <span>登入成功</span>
              </div>
              <div className="setup-step active">
                <div className="setup-step-dot active" />
                <span>個人化與偏好設定</span>
              </div>
              <div className="setup-step">
                <Circle size={18} />
                <span>生成初始課表</span>
              </div>
            </div>

            {/* Middle - Course checklist & Basic Info */}
            <div className="setup-courses">
              <h3 className="setup-section-title">1. 基本資料</h3>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <select value={department} onChange={e => setDepartment(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                  <option value="資訊工程學系">資訊工程學系</option>
                  <option value="電機工程學系">電機工程學系</option>
                  <option value="企業管理學系">企業管理學系</option>
                </select>
                <select value={grade} onChange={e => setGrade(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                  <option value="1">大一</option>
                  <option value="2">大二</option>
                  <option value="3">大三</option>
                  <option value="4">大四</option>
                </select>
                {/* 系上不接受必修換班，必修範圍必須收斂到班別。 */}
                <select
                  value={className}
                  onChange={e => setClassName(e.target.value)}
                  disabled={classOptions.length === 0}
                  style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                  id="setup-class-select"
                >
                  <option value="">未指定班別</option>
                  {classOptions.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div style={{ marginTop: '-12px', marginBottom: '20px', fontSize: '0.8rem', color: '#6b7280' }}>
                系上不接受必修課程換班。指定班別後，才只會排入你實際選得到的必修。
              </div>

              <h3 className="setup-section-title">2. 已經修過的選修課程</h3>
              {loading ? (
                <div style={{ padding: '20px', color: '#6b7280' }}>載入中...</div>
              ) : electiveError ? (
                <div className="error-text" role="alert">{electiveError}</div>
              ) : (
                <div className="setup-course-list">
                  {electives.length > 0 ? electives.map(course => (
                    <label key={course.id} className="setup-course-item" id={`setup-course-${course.id}`}>
                      <input
                        type="checkbox"
                        checked={checkedCourses.has(course.id)}
                        onChange={() => toggleCourse(course.id)}
                      />
                      <span>{course.name}</span>
                    </label>
                  )) : (
                    <div style={{color: '#888', fontSize: '0.9rem'}}>尚無符合的選修課程</div>
                  )}
                </div>
              )}
            </div>

            {/* Right - Preference tags */}
            <div className="setup-preferences">
              <h3 className="setup-section-title">3. 排課偏好設定</h3>
              {Object.entries(PREFERENCE_TAGS).map(([category, tags]) => (
                <div key={category} className="setup-pref-group">
                  <h4 className="setup-pref-category">{category}</h4>
                  <div className="setup-pref-tags">
                    {tags.map(tag => (
                      <button
                        key={tag}
                        className={`setup-tag ${selectedTags.has(tag) ? 'selected' : ''}`}
                        onClick={() => toggleTag(tag)}
                        id={`tag-${tag.replace('#', '')}`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom CTA */}
        {!generating && (
          <div className="setup-footer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            {/* profile 載入完成前送出會把暫時值寫回去，蓋掉已儲存的設定。 */}
            <button
              className="setup-submit-btn"
              onClick={handleSubmit}
              disabled={!profileLoaded}
              id="setup-submit-btn"
            >
              <Sparkles size={18} />
              {profileLoaded ? '完成設定，生成推薦課表 ✨' : '載入設定中...'}
            </button>
            
            <button 
              onClick={() => {
                localStorage.clear();
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
