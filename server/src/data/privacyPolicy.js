// 2026-10-14.v4：新增 collaborative_learning（協同過濾）。升版後所有人需重新確認一次。
export const PRIVACY_POLICY_VERSION = '2026-10-14.v4';

export const PRIVACY_PURPOSES = Object.freeze({
  SERVICE_PROCESSING: 'service_processing',
  PERSONALIZATION_LEARNING: 'personalization_learning',
  AGGREGATE_RESEARCH: 'aggregate_research',
  COLLABORATIVE_LEARNING: 'collaborative_learning',
});

export const PRIVACY_RETENTION = Object.freeze({
  rawChatDays: 30,
  interactionEventDays: 180,
  exportArtifactDays: 30,
  inactiveServiceDataDays: 365,
  consentAuditAfterWithdrawalDays: 365,
  researchMinimumCohortSize: 5,
  // 協同過濾：一組「修過 A 也修過 B」至少要有這麼多位同學才會被使用。
  collaborativeMinimumCooccurrence: 3,
});

export const PRIVACY_POLICY = Object.freeze({
  version: PRIVACY_POLICY_VERSION,
  effectiveAt: '2026-10-14T00:00:00+08:00',
  purposes: [
    {
      id: PRIVACY_PURPOSES.SERVICE_PROCESSING,
      required: true,
      defaultGranted: false,
      title: '提供排課與 AI 對話服務',
      description: '使用 Profile、修課歷史、偏好、已存課表及近期對話，提供排課、畢業檢核與對話連續性。對話會傳送至 OpenAI。',
      data: ['profile', 'course_history', 'preferences', 'saved_schedules', 'encrypted_raw_chat'],
    },
    {
      id: PRIVACY_PURPOSES.PERSONALIZATION_LEARNING,
      required: false,
      defaultGranted: false,
      title: '從互動持續改善個人化',
      description: '允許系統從課程瀏覽、收藏、評價、選課、退選原因與初始探索回饋，學習你對課程主題標籤的興趣。系統保存去識別化互動事件、事件當下的標籤快照及可重算的個人標籤興趣檔案；Raw Chat 不會成為此用途的輸入。',
      data: [
        'pseudonymous_interaction_events',
        'tag_interest_event_snapshots',
        'learned_preference_weights',
        'learned_tag_interests',
      ],
    },
    {
      id: PRIVACY_PURPOSES.COLLABORATIVE_LEARNING,
      required: false,
      defaultGranted: false,
      // 「貢獻」需要這項同意；「接收」協同過濾分數只需要 personalization_learning（只用到本人資料與已彙總的共現表）。
      requires: [PRIVACY_PURPOSES.PERSONALIZATION_LEARNING],
      title: '協助推薦課程給其他同學',
      description: '讓我的修課與課程互動紀錄（不含學號與姓名），協助推薦課程給其他同學。只有至少 3 位同學共同的修課組合才會被使用；需先同意「從互動持續改善個人化」。',
      data: ['course_cooccurrence_aggregates'],
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
  processors: [{ name: 'OpenAI', purpose: 'AI 對話與課程規劃回覆' }],
});

export function isPrivacyPurpose(value) {
  return Object.values(PRIVACY_PURPOSES).includes(value);
}

export default PRIVACY_POLICY;
