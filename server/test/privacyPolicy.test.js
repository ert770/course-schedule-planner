import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIVACY_POLICY, PRIVACY_PURPOSES } from '../src/data/privacyPolicy.js';

test('#33 policy keeps optional purposes opt-in and research aggregate-only', () => {
  const byId = Object.fromEntries(PRIVACY_POLICY.purposes.map(item => [item.id, item]));
  assert.equal(byId[PRIVACY_PURPOSES.SERVICE_PROCESSING].required, true);
  assert.equal(byId[PRIVACY_PURPOSES.PERSONALIZATION_LEARNING].defaultGranted, false);
  assert.equal(byId[PRIVACY_PURPOSES.AGGREGATE_RESEARCH].defaultGranted, false);
  assert.equal(PRIVACY_POLICY.retention.rawChatDays, 30);
  assert.equal(PRIVACY_POLICY.retention.researchMinimumCohortSize, 5);
});
