import { createHash } from 'node:crypto';
import { isMysqlConfigured, queryRows } from '../db/mysql.js';
import { getAll } from '../db/database.js';
import { ACTIVE_TERM } from '../data/activeTerm.js';
import { PRIVACY_RETENTION } from '../data/privacyPolicy.js';
import { interestTagCatalog } from '../data/interestTagCatalog.js';
import { deriveSubjectId, toMysqlDate, useMemoryStore } from './privacyService.js';
import { getInteractionEventsForExport, hasPersonalizationConsent } from './interactionEventService.js';
import {
  TAG_INTEREST_MODEL_VERSION,
  computeTagInterestProfile,
} from '../skills/tagInterestLearning.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const memoryStore = { profiles: new Map() };

export function resetTagInterestStoreForTests() {
  memoryStore.profiles = new Map();
}

function dateValue(value) {
  return value instanceof Date ? value : new Date(value);
}

function expiryFrom(computedAt) {
  return new Date(computedAt.getTime() + PRIVACY_RETENTION.interactionEventDays * 86400000);
}

function rowToProfile(row) {
  if (!row) return null;
  const profileValue = row.profile ?? row.profile_json;
  return {
    modelVersion: row.modelVersion ?? row.model_version,
    catalogVersion: row.catalogVersion ?? row.catalog_version,
    eligibilityVersion: row.eligibilityVersion ?? row.eligibility_version ?? null,
    priorSignature: row.priorSignature ?? row.prior_signature,
    profile: typeof profileValue === 'string' ? JSON.parse(profileValue) : profileValue,
    computedAt: dateValue(row.computedAt ?? row.computed_at).toISOString(),
    expiresAt: dateValue(row.expiresAt ?? row.expires_at).toISOString(),
  };
}

function priorSignature(profile) {
  return createHash('sha256').update(JSON.stringify({
    explicitTopics: profile.explicitTopics,
    categoryInterests: profile.categoryInterests,
    tagPriors: (profile.tagInterests ?? [])
      .filter(tag => tag.prior > 0)
      .map(tag => [tag.canonicalTagId, tag.prior]),
    unmappedTopics: profile.unmappedExplicitTopics,
  })).digest('hex');
}

async function readPreferences(identity, override) {
  if (override !== undefined) return override ?? {};
  const rows = await getAll('user_preferences');
  return rows.find(row => String(row.userId) === String(identity.canonicalId)) ?? {};
}

async function getRow(subjectId) {
  if (useMemoryStore()) return memoryStore.profiles.get(subjectId) ?? null;
  if (!isMysqlConfigured()) return null;
  const rows = await queryRows('SELECT * FROM Learned_Tag_Interests WHERE subject_id = ?', [subjectId]);
  return rows[0] ?? null;
}

async function upsertRow(row) {
  if (useMemoryStore()) {
    memoryStore.profiles.set(row.subjectId, row);
    return;
  }
  if (!isMysqlConfigured()) return;
  await queryRows(
    `INSERT INTO Learned_Tag_Interests
      (subject_id, model_version, catalog_version, eligibility_version, prior_signature,
       profile_json, computed_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       model_version = VALUES(model_version),
       catalog_version = VALUES(catalog_version),
       eligibility_version = VALUES(eligibility_version),
       prior_signature = VALUES(prior_signature),
       profile_json = VALUES(profile_json),
       computed_at = VALUES(computed_at),
       expires_at = VALUES(expires_at)`,
    [
      row.subjectId, row.modelVersion, row.catalogVersion, row.eligibilityVersion,
      row.priorSignature, JSON.stringify(row.profile), toMysqlDate(row.computedAt), toMysqlDate(row.expiresAt),
    ]
  );
}

export async function getStoredTagInterestProfile(identity) {
  return rowToProfile(await getRow(deriveSubjectId(identity.canonicalId)));
}

function removeExpiredEvents(events, now) {
  const retentionMs = PRIVACY_RETENTION.interactionEventDays * 86400000;
  return events.filter(event => {
    const timestamp = Date.parse(event.timestamp ?? '');
    return Number.isFinite(timestamp) && now.getTime() - timestamp <= retentionMs;
  });
}

/** Recompute the user's tag profile from immutable interaction snapshots. */
export async function recomputeTagInterestProfile(identity, options = {}) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  const now = dateValue(options.now ?? new Date());
  const prefs = await readPreferences(identity, options.prefs);
  const consented = await hasPersonalizationConsent(identity);
  const events = consented
    ? removeExpiredEvents(await getInteractionEventsForExport(identity), now)
    : [];
  const profile = computeTagInterestProfile(events, prefs, {
    now,
    activeTerm: options.activeTerm ?? ACTIVE_TERM,
  });

  if (consented) {
    await upsertRow({
      subjectId,
      modelVersion: TAG_INTEREST_MODEL_VERSION,
      catalogVersion: profile.catalogVersion,
      eligibilityVersion: profile.eligibilityVersion,
      priorSignature: priorSignature(profile),
      profile,
      computedAt: now.toISOString(),
      expiresAt: expiryFrom(now).toISOString(),
    });
  }
  return {
    consented,
    source: consented ? 'learned' : 'no-consent',
    profile,
    computedAt: consented ? now.toISOString() : null,
  };
}

/** Read the current profile, refreshing the cache when evidence, priors, or versions change. */
export async function getTagInterestProfile(identity, options = {}) {
  const consented = await hasPersonalizationConsent(identity);
  const prefs = await readPreferences(identity, options.prefs);
  if (!consented) {
    return {
      consented: false,
      source: 'no-consent',
      profile: computeTagInterestProfile([], prefs, {
        now: options.now ?? new Date(),
        activeTerm: options.activeTerm ?? ACTIVE_TERM,
      }),
      computedAt: null,
    };
  }

  const now = dateValue(options.now ?? new Date());
  const [stored, events] = await Promise.all([
    getStoredTagInterestProfile(identity),
    getInteractionEventsForExport(identity),
  ]);
  const currentEvents = removeExpiredEvents(events, now);
  const latestEventAt = currentEvents.reduce((latest, event) => (
    !latest || event.timestamp > latest ? event.timestamp : latest
  ), null);
  const wantedProfile = computeTagInterestProfile([], prefs);
  const signature = priorSignature(wantedProfile);
  const stale = !stored
    || stored.modelVersion !== TAG_INTEREST_MODEL_VERSION
    || stored.catalogVersion !== interestTagCatalog.catalogVersion
    || stored.eligibilityVersion !== wantedProfile.eligibilityVersion
    || stored.priorSignature !== signature
    || new Date(stored.expiresAt) <= now
    || now.getTime() - new Date(stored.computedAt).getTime() > CACHE_TTL_MS
    || Boolean(latestEventAt && latestEventAt > stored.computedAt);

  if (!stale) return { consented: true, source: 'learned', ...stored };
  return recomputeTagInterestProfile(identity, { ...options, prefs, now });
}

export async function deleteTagInterestProfile(subjectId) {
  if (useMemoryStore()) {
    const existed = memoryStore.profiles.delete(subjectId);
    return { tagInterestProfilesDeleted: existed ? 1 : 0 };
  }
  if (!isMysqlConfigured()) return { tagInterestProfilesDeleted: 0 };
  const result = await queryRows('DELETE FROM Learned_Tag_Interests WHERE subject_id = ?', [subjectId]);
  return { tagInterestProfilesDeleted: Number(result.affectedRows || 0) };
}

export async function cleanupExpiredTagInterestProfiles({ dryRun = true } = {}) {
  if (useMemoryStore()) {
    const now = Date.now();
    const expired = [...memoryStore.profiles.values()]
      .filter(row => new Date(row.expiresAt) <= now).length;
    if (!dryRun) {
      for (const [subjectId, row] of memoryStore.profiles) {
        if (new Date(row.expiresAt) <= now) memoryStore.profiles.delete(subjectId);
      }
    }
    return { expiredTagInterestProfiles: expired };
  }
  if (!isMysqlConfigured()) return { expiredTagInterestProfiles: 0 };
  const [count] = await queryRows(
    'SELECT COUNT(*) AS count FROM Learned_Tag_Interests WHERE expires_at <= UTC_TIMESTAMP(3)'
  );
  if (!dryRun) {
    await queryRows('DELETE FROM Learned_Tag_Interests WHERE expires_at <= UTC_TIMESTAMP(3)');
  }
  return { expiredTagInterestProfiles: Number(count.count) };
}

export default {
  getTagInterestProfile,
  recomputeTagInterestProfile,
  getStoredTagInterestProfile,
  deleteTagInterestProfile,
  cleanupExpiredTagInterestProfiles,
  resetTagInterestStoreForTests,
};
