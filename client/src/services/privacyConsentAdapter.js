export function consentChoicesFromStatus(consents) {
  return {
    // The required checkbox is fixed as checked; pressing Continue is the user's affirmative action.
    necessary: true,
    personalized: consents?.personalization_learning?.granted === true,
    research: consents?.aggregate_research?.granted === true,
  };
}

export function consentChoicesToPayload(choices) {
  return {
    service_processing: choices?.necessary === true,
    personalization_learning: choices?.personalized === true,
    aggregate_research: choices?.research === true,
  };
}
