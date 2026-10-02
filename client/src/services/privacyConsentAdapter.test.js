import assert from 'node:assert/strict';
import test from 'node:test';
import { consentChoicesFromStatus, consentChoicesToPayload } from './privacyConsentAdapter.js';

test('reads optional choices from canonical server purpose IDs', () => {
  assert.deepEqual(consentChoicesFromStatus({
    service_processing: { granted: false },
    personalization_learning: { granted: true },
    aggregate_research: { granted: false },
  }), { necessary: true, personalized: true, research: false });
});

test('sends choices using canonical server purpose IDs', () => {
  assert.deepEqual(consentChoicesToPayload({ necessary: true, personalized: false, research: true }), {
    service_processing: true,
    personalization_learning: false,
    aggregate_research: true,
  });
});

test('missing consent records leave optional purposes off', () => {
  assert.deepEqual(consentChoicesFromStatus({}), {
    necessary: true,
    personalized: false,
    research: false,
  });
});
