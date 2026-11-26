import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PreferenceJourneySteps from '../components/Layout/PreferenceJourneySteps';
import { controlledBrowserAPI, courseHistoryAPI } from '../services/api';

export default function HistoryOnboardingPage() {
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let current = true;

    async function findNextStep() {
      try {
        const { records } = await courseHistoryAPI.list();
        if (!current) return;
        if (!Array.isArray(records)) throw new Error('無法確認歷史修課紀錄。');
        if (records.length > 0) {
          navigate('/setup', { replace: true });
          return;
        }
      } catch {
        if (current) setNotice('目前無法讀取修課紀錄。你可以重試，或先繼續設定偏好。');
        return;
      }

      if (import.meta.env.DEV) {
        const config = await controlledBrowserAPI.config().catch(() => null);
        if (!current) return;
        if (config?.mode === 'local' && (config.sessionImport || config.localSelfAttested)) {
          navigate('/onboarding/myfcu', { replace: true });
          return;
        }
      }
      if (current) setNotice('這個環境尚未開放 MyFCU 匯入。你可以先設定偏好。');
    }

    void findNextStep();
    return () => { current = false; };
  }, [attempt, navigate]);

  return (
    <main className="preference-journey-surface">
      <section className="preference-journey-panel">
        <PreferenceJourneySteps current={2} />
        <header className="preference-page-header"><h1>MyFCU 匯入修課紀錄</h1></header>
        {notice ? (
          <>
            <p role="status">{notice}</p>
            <div className="setup-journey-actions">
              <button type="button" className="course-card-action" onClick={() => { setNotice(''); setAttempt(value => value + 1); }}>重新檢查</button>
              <Link className="course-card-action primary" to="/setup" replace>先設定排課偏好</Link>
            </div>
          </>
        ) : <p role="status">正在檢查修課紀錄…</p>}
      </section>
    </main>
  );
}
