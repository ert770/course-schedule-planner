import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import PreferenceJourneySteps from '../components/Layout/PreferenceJourneySteps';
import { useAuth } from '../contexts/useAuth';
import { useSchedule } from '../contexts/useSchedule';
import { profileAPI, scheduleAPI } from '../services/api';
import { buildScheduleNotice } from '../utils/scheduleNotice';
import { getUserIdentity } from '../utils/userIdentity';

export default function FirstSchedulePage() {
  const { user, isSetupDone, markSetupDone } = useAuth();
  const completed = isSetupDone();
  const ready = user?.initialSetupStage === 'schedule';
  const identity = getUserIdentity(user);
  const navigate = useNavigate();
  const { loading, saveFirstSchedule, beginScheduleGeneration, buildRecommendation, buildAvoidanceConstraints, userAddedCourseIds } = useSchedule();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const requestRef = useRef(null);

  useEffect(() => {
    if (!ready || completed || loading || identity === null) return undefined;
    if (requestRef.current?.identity !== identity || requestRef.current.attempt !== attempt) {
      requestRef.current = {
        attempt, identity, isLatest: beginScheduleGeneration(),
        result: scheduleAPI.generate({
          userId: identity,
          constraints: { sessionAvoidances: buildAvoidanceConstraints(), selectedCourseIds: userAddedCourseIds() },
          surface: 'dashboard',
          trigger: 'initial_load',
        }),
      };
    }
    let active = true;
    const job = requestRef.current;
    job.result.then(async result => {
      if (!active || !job.isLatest()) return;
      if (!result.success) {
        setError(buildScheduleNotice(result)?.message || '目前無法完成排課。');
        return;
      }
      if (!job.completion) {
        job.completion = (async () => {
          if (!await saveFirstSchedule(result, buildRecommendation(result), job.isLatest)) {
            throw new Error('新課表無法保留所有手動加選的課，請調整偏好後再試。');
          }
          if (job.isLatest()) await profileAPI.update({ initialSetupStage: 'completed' });
        })();
      }
      await job.completion;
      if (!active || !job.isLatest()) return;
      markSetupDone();
      navigate('/', { replace: true, state: { firstScheduleReady: identity } });
    }).catch(err => {
      if (active && job.isLatest()) setError(err.message || '目前無法完成排課。');
    });
    return () => { active = false; };
  }, [attempt, beginScheduleGeneration, buildAvoidanceConstraints, buildRecommendation, completed, identity, loading, markSetupDone, navigate, ready, saveFirstSchedule, userAddedCourseIds]);

  if (completed && !ready) return <Navigate to="/" replace />;
  if (!ready) return <Navigate to="/setup" replace />;

  return (
    <main className="preference-journey-surface">
      <section className="preference-journey-panel">
        <PreferenceJourneySteps current={4} />
        <header className="preference-page-header"><h1>完成排課</h1></header>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <div className="setup-journey-actions">
              <Link className="course-card-action" to="/setup" state={{ finishOnboarding: true }} replace>返回排課偏好</Link>
              <button type="button" className="course-card-action primary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>重新排課</button>
            </div>
          </>
        ) : <p role="status">正在依照修課紀錄與偏好規劃課表…</p>}
      </section>
    </main>
  );
}
