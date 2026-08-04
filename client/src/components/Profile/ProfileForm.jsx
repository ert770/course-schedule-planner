import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { profileAPI } from '../../services/api';

export default function ProfileForm() {
  const [prefs, setPrefs] = useState({
    displayName: '同學',
    completedCredits: 45,
    targetCreditsMin: 12,
    targetCreditsMax: 25,
    noMorningClasses: false,
    noEveningClasses: false,
    preferCompact: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const data = await profileAPI.get();
      setPrefs(prev => ({ ...prev, ...data }));
    } catch (err) {
      setError('載入偏好失敗：' + err.message);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await profileAPI.update(prefs);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError('儲存失敗：' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const Toggle = ({ label, desc, checked, onChange }) => (
    <div className="toggle-switch" onClick={() => onChange(!checked)}>
      <div className={`toggle-track ${checked ? 'active' : ''}`}>
        <div className="toggle-thumb" />
      </div>
      <div>
        <div className="toggle-label">{label}</div>
        {desc && <div className="toggle-desc">{desc}</div>}
      </div>
    </div>
  );

  return (
    <div className="profile-page animate-fadeInUp" id="profile-page">
      <div className="profile-section">
        <h2>👤 基本資訊</h2>
        <div className="card" style={{ padding: '24px' }}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">暱稱</label>
              <input
                className="input-field"
                value={prefs.displayName}
                onChange={(e) => setPrefs(p => ({ ...p, displayName: e.target.value }))}
                id="input-displayname"
              />
            </div>
            <div className="form-group">
              <label className="form-label">已修學分</label>
              <input
                type="number"
                className="input-field"
                value={prefs.completedCredits}
                onChange={(e) => setPrefs(p => ({ ...p, completedCredits: parseInt(e.target.value) || 0 }))}
                id="input-completed-credits"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="profile-section">
        <h2>🎯 排課偏好</h2>
        <div className="card" style={{ padding: '24px' }}>
          <div className="form-row" style={{ marginBottom: '16px' }}>
            <div className="form-group">
              <label className="form-label">目標學分下限</label>
              <input
                type="number"
                className="input-field"
                value={prefs.targetCreditsMin}
                onChange={(e) => setPrefs(p => ({ ...p, targetCreditsMin: parseInt(e.target.value) || 0 }))}
                id="input-min-credits"
              />
            </div>
            <div className="form-group">
              <label className="form-label">目標學分上限</label>
              <input
                type="number"
                className="input-field"
                value={prefs.targetCreditsMax}
                onChange={(e) => setPrefs(p => ({ ...p, targetCreditsMax: parseInt(e.target.value) || 0 }))}
                id="input-max-credits"
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Toggle
              label="不排早八 (第一節)"
              desc="避免排到 08:10 開始的課程"
              checked={prefs.noMorningClasses}
              onChange={(v) => setPrefs(p => ({ ...p, noMorningClasses: v }))}
            />
            <Toggle
              label="不排晚課"
              desc="避免排到 18:00 以後的課程"
              checked={prefs.noEveningClasses}
              onChange={(v) => setPrefs(p => ({ ...p, noEveningClasses: v }))}
            />
            <Toggle
              label="偏好集中排課"
              desc="盡量將課程集中在較少天數"
              checked={prefs.preferCompact}
              onChange={(v) => setPrefs(p => ({ ...p, preferCompact: v }))}
            />
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 'var(--radius-sm)',
          color: '#fca5a5',
          fontSize: '0.85rem',
          marginBottom: '16px'
        }}>
          {error}
        </div>
      )}

      <button
        className="btn-primary"
        onClick={handleSave}
        disabled={saving}
        style={{ width: '100%', padding: '14px', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        id="save-profile-btn"
      >
        <Save size={18} />
        {saving ? '儲存中...' : saved ? '✅ 已儲存！' : '儲存偏好設定'}
      </button>
    </div>
  );
}
