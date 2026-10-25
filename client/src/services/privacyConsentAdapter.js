export function consentChoicesFromStatus(consents) {
  const personalized = consents?.personalization_learning?.granted === true;
  return {
    // The required checkbox is fixed as checked; pressing Continue is the user's affirmative action.
    necessary: true,
    personalized,
    // 協同過濾以個人化學習為前提（伺服器同樣會強制）。
    collaborative: personalized && consents?.collaborative_learning?.granted === true,
    research: consents?.aggregate_research?.granted === true,
  };
}

export function consentChoicesToPayload(choices) {
  const personalized = choices?.personalized === true;
  return {
    service_processing: choices?.necessary === true,
    personalization_learning: personalized,
    // 一定要送出這個欄位：漏送會被伺服器當成不同意，等於悄悄撤回。
    collaborative_learning: personalized && choices?.collaborative === true,
    aggregate_research: choices?.research === true,
  };
}
