import fs from 'node:fs';
import { normalizeInterestList } from './interestPreferences.js';
import { normalizeInterestTag } from './interestTagVocabulary.js';

const catalogUrl = new URL('./interestTagCatalog.json', import.meta.url);
const aliasesUrl = new URL('./interestTagAliases.json', import.meta.url);

export const interestTagCatalog = JSON.parse(fs.readFileSync(catalogUrl, 'utf8'));
export const interestTagAliases = JSON.parse(fs.readFileSync(aliasesUrl, 'utf8'));

function makeAliasIndex(aliases) {
  const index = new Map();
  for (const [alias, canonical] of Object.entries(aliases?.aliases ?? {})) {
    const aliasKey = normalizeInterestTag(alias);
    const canonicalLabel = String(canonical ?? '').trim();
    if (aliasKey && canonicalLabel) index.set(aliasKey, canonicalLabel);
  }
  return index;
}

const aliasIndex = makeAliasIndex(interestTagAliases);
const tagByCanonicalKey = new Map(
  interestTagCatalog.canonicalTags.map(tag => [normalizeInterestTag(tag.name), tag]),
);
const tagByRawKey = new Map();
for (const tag of interestTagCatalog.canonicalTags) {
  for (const assignment of tag.categoryAssignments) {
    for (const source of assignment.sourceRows) {
      const key = normalizeInterestTag(source.rawTag);
      if (key && !tagByRawKey.has(key)) tagByRawKey.set(key, tag);
    }
  }
}
const mainCategoryById = new Map(interestTagCatalog.mainCategories.map(item => [item.id, item]));
const subcategoryById = new Map(interestTagCatalog.subcategories.map(item => [item.id, item]));

function publicCategoryPaths(tag) {
  return tag.categoryAssignments.map(assignment => ({
    mainCategoryId: assignment.mainCategoryId,
    mainCategory: mainCategoryById.get(assignment.mainCategoryId)?.name ?? null,
    subcategoryId: assignment.subcategoryId,
    subcategory: subcategoryById.get(assignment.subcategoryId)?.name ?? null,
    rawForms: [...new Set(assignment.sourceRows.map(source => source.rawTag))],
  }));
}

function publicTag(rawTag, tag, resolution) {
  return {
    rawTag,
    canonicalTagId: tag.id,
    canonicalName: tag.name,
    resolution,
    categoryPaths: publicCategoryPaths(tag),
    eligibility: { ...tag.eligibility },
  };
}

/** Resolve one source rag_tag without discarding its original spelling. */
export function resolveInterestTag(rawTag) {
  const source = normalizeInterestList([rawTag])[0] ?? '';
  const lookupKey = normalizeInterestTag(source);
  if (!lookupKey) {
    return { rawTag: source, status: 'empty', canonicalTagId: null, categoryPaths: [] };
  }

  const aliasCanonical = aliasIndex.get(lookupKey);
  const canonicalKey = normalizeInterestTag(aliasCanonical ?? source);
  const tag = tagByCanonicalKey.get(canonicalKey);
  if (tag) return { ...publicTag(source, tag, aliasCanonical ? 'approved_alias' : 'catalog_match'), status: 'resolved' };

  // Keep known workbook surface forms usable even if an alias target is absent
  // from a future catalog build; the raw mapping remains explicit in the result.
  if (!aliasCanonical) {
    const rawMatch = tagByRawKey.get(lookupKey);
    if (rawMatch) return { ...publicTag(source, rawMatch, 'catalog_match'), status: 'resolved' };
  }

  return {
    rawTag: source,
    status: aliasCanonical ? 'unresolved_alias_target' : 'unmapped',
    canonicalTagId: null,
    canonicalName: aliasCanonical ?? null,
    categoryPaths: [],
  };
}

/** Resolve and deduplicate a course's labels by canonical ID. */
export function resolveInterestTags(rawTags) {
  const sources = normalizeInterestList(Array.isArray(rawTags) ? rawTags : [rawTags]);
  const byId = new Map();
  const unknownTags = [];

  for (const rawTag of sources) {
    const resolved = resolveInterestTag(rawTag);
    if (resolved.status !== 'resolved') {
      if (resolved.status !== 'empty') unknownTags.push(resolved);
      continue;
    }
    const existing = byId.get(resolved.canonicalTagId);
    if (existing) existing.matchedRawTags.push(rawTag);
    else byId.set(resolved.canonicalTagId, { ...resolved, matchedRawTags: [rawTag] });
  }

  return { tags: [...byId.values()], unknownTags };
}

/** Pending eligibility never grants a learning or matching signal. */
export function isEligibleForInterestLearning(resolvedTag) {
  return resolvedTag?.eligibility?.interestLearningEligible === true;
}

export function isEligibleForCrossCourseMatch(resolvedTag) {
  return resolvedTag?.eligibility?.crossCourseMatchEligible === true;
}
