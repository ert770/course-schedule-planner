import { useEffect, useState } from 'react';
import { Sparkles, Info, Ban } from 'lucide-react';
import { privacyAPI } from '../../services/api';

// Roadmap #31：使用者有權知道眼前的課表是照他自己勾的、系統學的、還是根本
// 沒有資料。`sufficiency.status`（顯式／學習／資料不足／未同意）在 `#30`
// 就已經算得出來，但從沒接到任何畫面——這個元件就是把它接上去的那一步。
//
// 「已學到偏好（尚未套用）」不是模稜兩可的說法：`#5B`（2026-09-05）已把學到的
// 權重接進排課，但只在**方案層**（`scheduler.js` 的 `evaluatePreference()`，
// 決定五個方案哪一個主推）——單一門課的排序（`scoreCourse()`）仍然沒有接，
// 那是 `#7` 的工作。`appliedToScheduling` 由後端回傳，這裡的兩種文案（已套用／
// 尚未套用）不必再改，因為旗標的語意本來就只承諾「有進排課決策」。
const COPY = {
  'no-consent': {
    icon: Ban,
    label: '未啟用個人化學習',
    note: '只依你自己勾選的偏好排課。可到「隱私與資料」啟用。',
    muted: true,
  },
  'insufficient-empty': {
    icon: Info,
    label: '尚未表達偏好',
    note: '目前沒有任何偏好可用，課表只保證合法，個人化程度有限。',
    muted: true,
  },
  insufficient: {
    icon: Info,
    label: '使用你的顯式設定',
    note: null, // 動態帶入還差幾筆，見 buildNote()
    muted: false,
  },
  explicit: {
    icon: Info,
    label: '使用你的顯式設定',
    note: '目前的行為紀錄沒有指向任何額外方向。',
    muted: false,
  },
  'learned-pending': {
    icon: Sparkles,
    label: '已學到偏好（尚未套用）',
    note: '系統已從行為學到方向，但目前排課仍只用你的顯式設定。',
    muted: false,
  },
  learned: {
    icon: Sparkles,
    label: '使用學習到的偏好',
    note: '依你的行為調整，顯式設定仍是下限。',
    muted: false,
  },
};

function resolveCopyKey(personalization) {
  if (!personalization) return null;
  const { source, explicitProfileEmpty, appliedToScheduling } = personalization;
  if (source === 'no-consent') return 'no-consent';
  if (source === 'insufficient') return explicitProfileEmpty ? 'insufficient-empty' : 'insufficient';
  if (source === 'learned') return appliedToScheduling ? 'learned' : 'learned-pending';
  return 'explicit';
}

function buildNote(copyKey, personalization) {
  if (copyKey !== 'insufficient') return COPY[copyKey]?.note ?? null;
  const { usableEventCount, requiredEventCount } = personalization.sufficiency || {};
  return Number.isFinite(usableEventCount) && Number.isFinite(requiredEventCount)
    ? `互動資料還不夠（${usableEventCount}/${requiredEventCount} 筆），系統不會拿不足的資料冒充個人偏好。`
    : '互動資料還不夠，系統不會拿不足的資料冒充個人偏好。';
}

export default function PreferenceSourceBadge({ variant = 'compact', personalization: controlled }) {
  const [fetched, setFetched] = useState(null);
  const [error, setError] = useState('');

  // 有 `controlled`（PrivacyPage 已經自己抓過）就不重複打 API；沒有
  // （Dashboard 側欄）就自己抓一次——兩個呼叫端不必各寫一份載入邏輯。
  useEffect(() => {
    if (controlled !== undefined) return;
    privacyAPI.getPersonalization().then(setFetched).catch(err => setError(err.message));
  }, [controlled]);

  const personalization = controlled !== undefined ? controlled : fetched;
  if (error || !personalization) return null;

  const copyKey = resolveCopyKey(personalization);
  const copy = COPY[copyKey];
  if (!copy) return null;
  const Icon = copy.icon;
  const note = buildNote(copyKey, personalization);

  return (
    <div className={`preference-source preference-source-${variant}`} id={variant === 'detail' ? 'personalization-source' : undefined}>
      <span className={`preference-source-badge${copy.muted ? ' is-muted' : ''}`}>
        <Icon size={14} />
        {copy.label}
      </span>
      {note && <p className="preference-source-note">{note}</p>}
    </div>
  );
}
