import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { coursesAPI, profileAPI } from '../services/api';
import { Sparkles, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import AvoidTimePicker from '../components/Setup/AvoidTimePicker';

// 標籤清單改由 `GET /api/profile/preference-tags` 提供，不再在前端寫死。
//
// 先前這份清單前端有兩份（本檔與 `DashboardPage.jsx`）、後端一份，共三份各自
// 維護。實測時 Dashboard 那份已經漏掉 `#不點名` 且用的是舊布林 key——
// 人工對照多份清單必然漂移。唯一定義來源是
// `server/src/data/preferenceTags.js`，那也是標籤與排課旗標的對照表。

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
  // profile 尚未載入完成前不得送出，否則會用暫時值覆蓋已儲存的設定。
  const [profileLoaded, setProfileLoaded] = useState(false);

  const [selectedTags, setSelectedTags] = useState(new Set());
  // 標籤目錄由後端提供（單一定義來源），不在前端寫死。
  const [tagGroups, setTagGroups] = useState([]);
  // 對應 `User_Profiles.avoid_time`，第 1～14 節皆可。與 `#不排早八` 標籤
  // 是兩組獨立設定（逐格 vs 每天第一節），排課時取聯集。
  const [avoidPeriods, setAvoidPeriods] = useState([]);
  const [generating, setGenerating] = useState(false);

  // 標籤目錄不隨使用者變動，載入一次即可。
  useEffect(() => {
    let cancelled = false;

    profileAPI.getPreferenceTags()
      .then(data => {
        if (!cancelled) setTagGroups(data.groups || []);
      })
      .catch(() => { /* 取不到就不顯示標籤區，不阻斷其餘設定流程 */ });

    return () => { cancelled = true; };
  }, []);

  // 帶回已儲存的系所、年級與班別。沒有這一步，使用者只要進到設定頁按儲存，
  // 已存的班別就會被空值蓋掉——表單送出的是它自己的初始值，而初始值裡沒有班別。
  useEffect(() => {
    let cancelled = false;

    // 未登入時不退回 `default` 使用者，沿用初始值。
    if (!user?.studentId) {
      setProfileLoaded(true);
      return () => { cancelled = true; };
    }

    profileAPI.get(user.studentId)
      .then(profile => {
        if (cancelled || !profile) return;
        if (profile.department) setDepartment(profile.department);
        const savedGrade = profile.gradeLevel ?? profile.grade;
        if (savedGrade) setGrade(String(savedGrade));
        if (profile.className) setClassName(profile.className);

        // 已儲存的偏好必須帶回表單，否則使用者一進設定頁按儲存，
        // 先前勾選的標籤會被空的初始值蓋掉——與班別是同一類問題。
        // 偏好的真相來源是 `User_Profiles.preference_tags`。
        if (Array.isArray(profile.selectedTags)) {
          setSelectedTags(new Set(profile.selectedTags));
        }
        if (Array.isArray(profile.blockedPeriods)) {
          setAvoidPeriods(profile.blockedPeriods);
        }
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

  const toggleTag = (tag) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const handleSubmit = async () => {
    // 偏好會寫進這位使用者的 profile，沒有身分就不能存。
    if (!user?.studentId) {
      alert('尚未登入，無法儲存個人偏好設定。請重新登入後再試。');
      return;
    }

    setGenerating(true);
    try {
      // **只送標籤，不逐一送 12 個布林。**
      //
      // 每個標籤與一個排課旗標一對一，布林由後端從標籤推導
      // （`server/src/data/preferenceTags.js`）。前端逐一展開會變成
      // 同一份資訊存兩種格式，而兩種格式一旦不同步就沒有東西能判斷誰對。
      const prefData = {
        department,
        grade,
        className,
        selectedTags: [...selectedTags],
        // 第 1～14 節皆可。後端不再篩掉第 1 節。
        blockedPeriods: avoidPeriods,
      };
      await profileAPI.update(prefData, user.studentId);

      markSetupDone();

      // 這裡原本另外把 prefData 寫進 `localStorage.fcu_initial_prefs` 給 Dashboard 用。
      // 那是同一份偏好的第二份副本——Setup 改存標籤陣列之後，Dashboard 仍在讀
      // 舊格式的布林鍵，側邊面板因此永遠不打勾。Dashboard 現在直接向 profile API
      // 要同一份資料，不需要副本。

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

            {/* Middle - Basic Info */}
            <div className="setup-courses">
              <h3 className="setup-section-title">1. 基本資料</h3>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                <select 
                  value={department} 
                  onChange={e => setDepartment(e.target.value)} 
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', outline: 'none', cursor: 'pointer' }}
                >
                  <option value="資訊工程學系">資訊工程學系</option>
                  <option value="電機工程學系">電機工程學系</option>
                  <option value="企業管理學系">企業管理學系</option>
                </select>
                <select 
                  value={grade} 
                  onChange={e => setGrade(e.target.value)} 
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', outline: 'none', cursor: 'pointer' }}
                >
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
            </div>

            {/* Right - Preference tags */}
            <div className="setup-preferences">
              <h3 className="setup-section-title">2. 排課偏好設定</h3>
              {tagGroups.map(({ category, tags }) => (
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

              <div className="setup-pref-group">
                <h4 className="setup-pref-category">避開特定時段</h4>
                <AvoidTimePicker value={avoidPeriods} onChange={setAvoidPeriods} />
              </div>
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
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
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