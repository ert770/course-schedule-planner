import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Download, Trash2 } from 'lucide-react';
import { privacyAPI } from '../services/api';
import { useAuth } from '../contexts/useAuth';

const SERVICE = 'service_processing';
const PERSONALIZATION = 'personalization_learning';
const RESEARCH = 'aggregate_research';

export default function PrivacyPage() {
  const navigate = useNavigate();
  const { privacyStatus, refreshPrivacy, isSetupDone, logout } = useAuth();
  const [policy, setPolicy] = useState(privacyStatus?.policy || null);
  const [choices, setChoices] = useState({ [SERVICE]: false, [PERSONALIZATION]: false, [RESEARCH]: false });
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    privacyAPI.getPolicy().then(setPolicy).catch(err => setMessage(err.message));
  }, []);

  useEffect(() => {
    if (!privacyStatus) return;
    setPolicy(current => current || privacyStatus.policy);
    setChoices({
      [SERVICE]: privacyStatus.consents?.[SERVICE]?.granted || false,
      [PERSONALIZATION]: privacyStatus.consents?.[PERSONALIZATION]?.granted || false,
      [RESEARCH]: privacyStatus.consents?.[RESEARCH]?.granted || false,
    });
  }, [privacyStatus]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      await privacyAPI.updateConsents(choices);
      const status = await refreshPrivacy();
      setMessage('資料使用設定已儲存。');
      if (status && !status.requiresAction) {
        setTimeout(() => navigate(isSetupDone() ? '/' : '/onboarding'), 350);
      }
    } catch (err) { setMessage(err.message); }
    finally { setSaving(false); }
  };

  const download = async () => {
    try {
      const data = await privacyAPI.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `privacy-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('資料匯出已下載；檔案未保存在伺服器。');
    } catch (err) { setMessage(err.message); }
  };

  const clearChat = async () => {
    if (!window.confirm('確定刪除你目前保存的 Raw Chat？已寫入 Profile 的結構化偏好不會被刪除。')) return;
    try {
      const result = await privacyAPI.clearChat();
      setMessage(`已刪除 ${result.deletedCount} 則 Raw Chat；Profile 偏好仍保留。`);
    } catch (err) { setMessage(err.message); }
  };

  const deleteData = async () => {
    const confirmationPhrase = window.prompt('這會刪除服務帳號與所有服務資料，且無法復原。請輸入「刪除我的資料」確認：');
    if (confirmationPhrase !== '刪除我的資料') {
      setMessage('未輸入正確確認詞，沒有刪除任何資料。');
      return;
    }
    try {
      const intent = await privacyAPI.createDeletionIntent();
      await privacyAPI.deleteData({ requestId: intent.requestId, token: intent.token, confirmationPhrase });
      logout();
      navigate('/login', { replace: true });
    } catch (err) { setMessage(err.message); }
  };

  const purposeById = id => policy?.purposes?.find(item => item.id === id);
  const retention = policy?.retention;

  return (
    <main className="privacy-page" id="privacy-page">
      <section className="privacy-card">
        <div className="privacy-heading"><ShieldCheck size={34} /><div><h1>隱私與資料使用</h1><p>政策版本：{policy?.version || '載入中'}</p></div></div>

        {privacyStatus?.error && <div className="privacy-message" role="alert">{privacyStatus.error}</div>}

        {[SERVICE, PERSONALIZATION, RESEARCH].map(id => {
          const purpose = purposeById(id);
          return (
            <label className="privacy-purpose" key={id}>
              <input
                id={`consent-${id}`}
                type="checkbox"
                checked={choices[id]}
                onChange={event => setChoices(current => ({ ...current, [id]: event.target.checked }))}
              />
              <span><strong>{purpose?.title || id}{purpose?.required ? '（必要）' : '（可選）'}</strong><small>{purpose?.description}</small></span>
            </label>
          );
        })}

        <div className="privacy-facts">
          <p>Raw Chat：AES-256-GCM 加密，保存 {retention?.rawChatDays ?? 30} 天，只供對話連續性，不用於個人化學習或研究。</p>
          <p>結構化偏好：你確認後寫入 Profile，因此清除 Raw Chat 不會清掉「不排早八」等偏好。</p>
          <p>研究：只輸出至少 {retention?.researchMinimumCohortSize ?? 5} 人的彙總統計，不輸出逐筆事件或完整修課歷史。</p>
        </div>

        {message && <div className="privacy-message" role="status">{message}</div>}
        <button className="privacy-primary" id="privacy-save" disabled={!choices[SERVICE] || saving} onClick={save}>
          {saving ? '儲存中…' : '儲存資料使用設定'}
        </button>

        <div className="privacy-actions">
          <button onClick={download}><Download size={16} /> 匯出我的資料</button>
          <button onClick={clearChat}><Trash2 size={16} /> 清除 Raw Chat</button>
          <button className="privacy-danger" onClick={deleteData}><Trash2 size={16} /> 刪除帳號與資料</button>
          {!privacyStatus?.requiresAction && <button onClick={() => navigate('/')}>返回首頁</button>}
        </div>
      </section>
    </main>
  );
}
