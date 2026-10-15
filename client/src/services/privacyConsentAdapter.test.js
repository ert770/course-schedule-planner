import assert from 'node:assert/strict';
import test from 'node:test';
import { consentChoicesFromStatus, consentChoicesToPayload } from './privacyConsentAdapter.js';

test('reads optional choices from canonical server purpose IDs', () => {
  assert.deepEqual(consentChoicesFromStatus({
    service_processing: { granted: false },
    personalization_learning: { granted: true },
    collaborative_learning: { granted: true },
    aggregate_research: { granted: false },
  }), { necessary: true, personalized: true, collaborative: true, research: false });
});

test('sends choices using canonical server purpose IDs', () => {
  assert.deepEqual(consentChoicesToPayload({ necessary: true, personalized: true, collaborative: true, research: true }), {
    service_processing: true,
    personalization_learning: true,
    collaborative_learning: true,
    aggregate_research: true,
  });
});

test('collaborative learning always travels in the payload so saving never silently withdraws it', () => {
  const choices = consentChoicesFromStatus({
    personalization_learning: { granted: true },
    collaborative_learning: { granted: true },
  });
  assert.equal(consentChoicesToPayload(choices).collaborative_learning, true);
});

test('collaborative learning requires personalization', () => {
  assert.equal(consentChoicesFromStatus({ collaborative_learning: { granted: true } }).collaborative, false);
  assert.equal(consentChoicesToPayload({ necessary: true, personalized: false, collaborative: true }).collaborative_learning, false);
});

test('missing consent records leave optional purposes off', () => {
  assert.deepEqual(consentChoicesFromStatus({}), {
    necessary: true,
    personalized: false,
    collaborative: false,
    research: false,
  });
});
