export const PRIVACY_POLICY_VERSION = '2026-08-22.v1';

export const PRIVACY_PURPOSES = Object.freeze({
  SERVICE_PROCESSING: 'service_processing',
  PERSONALIZATION_LEARNING: 'personalization_learning',
  AGGREGATE_RESEARCH: 'aggregate_research',
});

export const PRIVACY_RETENTION = Object.freeze({
  rawChatDays: 30,
  interactionEventDays: 180,
  exportArtifactDays: 30,
  inactiveServiceDataDays: 365,
  consentAuditAfterWithdrawalDays: 365,
  researchMinimumCohortSize: 5,
});

export const PRIVACY_POLICY = Object.freeze({
  version: PRIVACY_POLICY_VERSION,
  effectiveAt: '2026-08-22T00:00:00+08:00',
  purposes: [
    {
      id: PRIVACY_PURPOSES.SERVICE_PROCESSING,
      required: true,
      defaultGranted: false,
      title: '提供排課與 AI 對話服務',
      description: '使用 Profile、修課歷史、偏好、已存課表及近期對話，提供排課、畢業檢核與對話連續性。對話會傳送至 Gemini。',
      data: ['profile', 'course_history', 'preferences', 'saved_schedules', 'encrypted_raw_chat'],
    },
    {
      id: PRIVACY_PURPOSES.PERSONALIZATION_LEARNING,
      required: false,
      defaultGranted: false,
      title: '從互動持續改善個人化',
      description: '允許未來的 #2 互動事件與 #30 學習權重使用你的操作回饋。Raw Chat 不會成為此用途的輸入。',
      data: ['pseudonymous_interaction_events', 'learned_preference_weights'],
    },
    {
      id: PRIVACY_PURPOSES.AGGREGATE_RESEARCH,
      required: false,
      defaultGranted: false,
      title: '匿名彙總研究',
      description: '允許將符合門檻的彙總統計用於研究；不匯出逐筆事件、Raw Chat 或完整修課歷史。',
      data: ['aggregate_statistics'],
    },
  ],
  retention: PRIVACY_RETENTION,
  processors: [{ name: 'Google Gemini', purpose: 'AI 對話與課程規劃回覆' }],
});

export function isPrivacyPurpose(value) {
  return Object.values(PRIVACY_PURPOSES).includes(value);
}

export default PRIVACY_POLICY;
