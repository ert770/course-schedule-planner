import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PreferenceJourneySteps, { PreferenceBackButton } from '../components/Layout/PreferenceJourneySteps';
import PreferenceSourceBadge from '../components/Profile/PreferenceSourceBadge';
import { useAuth } from '../contexts/useAuth';
import { privacyAPI } from '../services/api';
import { consentChoicesFromStatus, consentChoicesToPayload } from '../services/privacyConsentAdapter';

const optionalUses = [
  {
    key: 'personalized',
    title: '從互動持續改善個人化',
    description: '讓系統參考你之後的課程互動與回饋，調整自己的推薦。',
  },
  {
    key: 'collaborative',
    title: '協助推薦課程給其他同學',
    description: '讓不含學號與姓名的修課及課程互動協助推薦。系統只使用至少 3 位同學共同的修課組合。',
  },
  {
    key: 'research',
    title: '匿名彙總研究',
    description: '讓符合門檻的彙總統計用於研究。不匯出逐筆事件或完整修課歷史。',
  },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { markOnboarded, refreshPrivacy, logout } = useAuth();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [consents, setConsents] = useState(null);
  const [personalization, setPersonalization] = useState(null);
  const [policyVersion, setPolicyVersion] = useState('');

  useEffect(() => {
    let cancelled = false;
    privacyAPI.getConsents()
      .then(status => {
        if (cancelled) return;
        setConsents(consentChoicesFromStatus(status?.consents));
        setPolicyVersion(status?.policy?.version ?? '');
      })
      .catch(() => {
        if (!cancelled) setError('無法讀取目前的資料使用設定。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    privacyAPI.getPersonalization()
      .then(data => {
        if (!cancelled && data) setPersonalization(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const retry = () => {
    setError('');
    setLoading(true);
    setLoadAttempt(previous => previous + 1);
  };

  const toggleConsent = (key) => {
    setConsents(previous => {
      if (!previous || (key === 'collaborative' && !previous.personalized)) return previous;
      const next = { ...previous, [key]: !previous[key] };
      if (key === 'personalized' && !next.personalized) next.collaborative = false;
      return next;
    });
  };

  const continueToSetup = async () => {
    if (!consents || saving) return;
    setSaving(true);
    setError('');
    try {
      await privacyAPI.updateConsents(consentChoicesToPayload(consents));
      markOnboarded();
      await refreshPrivacy().catch(() => {});
      navigate('/setup');
    } catch (err) {
      console.error('Failed to update consents:', err);
      setError(err.message || '隱私設定儲存失敗，請稍後再試。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main id="onboarding-page" className="preference-journey-surface">
      <section className="preference-journey-panel" aria-labelledby="consent-title">
        <PreferenceBackButton onClick={() => { logout(); navigate('/login', { replace: true }); }}>
          返回登入
        </PreferenceBackButton>
        <PreferenceJourneySteps current={1} />
        <header className="preference-page-header">
          <h1 id="consent-title">隱私與資料使用</h1>
          <p>請確認提供排課服務所需的資料用途，再選擇是否開啟其他功能。</p>
        </header>

        <div className="preference-consent-card required">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>提供排課與 AI 對話服務（必要）</strong>
            <p>使用你的個人資料、修課歷史、偏好、已存課表及近期對話，提供排課、畢業檢核與對話服務。對話會傳送給 OpenAI。</p>
          </div>
        </div>

        {loading && <p className="preference-consent-status" role="status">正在讀取你的資料使用設定…</p>}
        {error && (
          <div className="preference-consent-status" role="alert">
            <p>{error}</p>
            {!consents && !loading && <button type="button" className="course-card-action" onClick={retry}>重新載入</button>}
          </div>
        )}

        {consents && (
          <div className="preference-consent-options">
            <h2>可選用途</h2>
            {optionalUses.map(({ key, title, description }) => (
              <label className="preference-consent-card" key={key}>
                <input
                  id={`onboarding-consent-${key}`}
                  type="checkbox"
                  checked={consents[key]}
                  disabled={saving || (key === 'collaborative' && !consents.personalized)}
                  onChange={() => toggleConsent(key)}
                />
                <span>
                  <strong>{title}</strong>
                  <span className="preference-consent-description">{description}</span>
                  {key === 'collaborative' && <small>需先開啟「從互動持續改善個人化」。</small>}
                </span>
              </label>
            ))}
            {personalization && (
              <div className="preference-consent-source">
                <strong>目前個人化來源：</strong>
                <PreferenceSourceBadge variant="compact" personalization={personalization} />
              </div>
            )}
          </div>
        )}
        <p className="preference-consent-foot">
          可選用途可留空，之後可在隱私中心修改。{policyVersion && ` 政策版本 ${policyVersion}`}
        </p>
        <button
          type="button"
          className="onboarding-btn preference-consent-submit"
          disabled={saving || !consents}
          onClick={continueToSetup}
          id="onboarding-agree-btn"
        >
          {saving ? <><Loader2 size={18} className="spin-animation" /> 正在保存…</> : <>同意必要用途並繼續 <ArrowRight size={18} /></>}
        </button>
      </section>
    </main>
  );
}
