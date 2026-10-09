import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  interestTagCatalog,
  isEligibleForCrossCourseMatch,
  isEligibleForInterestLearning,
  resolveInterestTag,
  resolveInterestTags,
} from '../src/data/interestTagCatalog.js';
import { normalizeInterestTag } from '../src/data/interestTagVocabulary.js';

describe('rag_tag 興趣分類目錄', () => {
  test('匯入核准分類資料並保留多對多分類路徑', () => {
    assert.equal(interestTagCatalog.summary.mainCategoryCount, 19);
    assert.equal(interestTagCatalog.summary.categoryPathCount, 112);
    assert.equal(interestTagCatalog.summary.rawTagCount, 6846);
    assert.equal(interestTagCatalog.summary.categoryAssignmentCount, 15113);
    assert.equal(interestTagCatalog.summary.approvedAliasCount, 13);
    assert.equal(interestTagCatalog.catalogVersion, 'rag-tag-catalog-2026-10-09-v2');
    assert.ok(interestTagCatalog.mainCategories.some(category => category.name === '學習階段與課程情境'));
    assert.ok(!interestTagCatalog.mainCategories.some(category => category.name === '其他／待人工確認'));
    assert.deepEqual(interestTagCatalog.summary.aliasCanonicalTargetsMissingFromCatalog, []);
    assert.ok(interestTagCatalog.summary.rawTagsWithMultipleCategoryPaths > 0);
    assert.ok(interestTagCatalog.summary.canonicalTagsWithMultipleCategoryPaths > 0);
    assert.ok(interestTagCatalog.canonicalTags.every(tag => normalizeInterestTag(tag.name) === tag.normalizedName));
    assert.equal(
      interestTagCatalog.canonicalTags.reduce(
        (sum, tag) => sum + tag.categoryAssignments.reduce((count, path) => count + path.sourceRows.length, 0),
        0,
      ),
      15113,
    );

    const multiPathTag = interestTagCatalog.canonicalTags.find(tag => tag.categoryAssignments.length > 1);
    assert.ok(multiPathTag, 'expected at least one canonical tag assigned to multiple paths');
    const rawTag = multiPathTag.categoryAssignments[0].sourceRows[0].rawTag;
    const resolved = resolveInterestTag(rawTag);
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.categoryPaths.length, multiPathTag.categoryAssignments.length);
    assert.ok(resolved.categoryPaths.some(path => path.rawForms.includes(rawTag)));
    assert.deepEqual(
      resolved.categoryPaths.map(path => `${path.mainCategoryId}/${path.subcategoryId}`).sort(),
      multiPathTag.categoryAssignments.map(path => `${path.mainCategoryId}/${path.subcategoryId}`).sort(),
    );

    const uml = resolveInterestTag('UML');
    assert.equal(uml.status, 'resolved');
    assert.ok(uml.categoryPaths.some(path => (
      path.mainCategory === '資訊與計算' && path.subcategory === '程式、系統與資料'
    )));
  });

  test('套用核准別名並保留使用者原始標籤寫法', () => {
    const alias = resolveInterestTag('AI');
    const canonical = resolveInterestTag('人工智慧');

    assert.equal(alias.status, 'resolved');
    assert.equal(alias.resolution, 'approved_alias');
    assert.equal(alias.canonicalTagId, canonical.canonicalTagId);
    assert.equal(alias.canonicalName, '人工智慧');
    assert.equal(alias.rawTag, 'AI');
  });

  test('一門課同時有別名與標準寫法時依 canonical ID 去重', () => {
    const result = resolveInterestTags(['AI', '人工智慧', '未知主題']);
    assert.equal(result.tags.length, 1);
    assert.deepEqual(result.tags[0].matchedRawTags, ['AI', '人工智慧']);
    assert.equal(result.unknownTags.length, 1);
    assert.equal(result.unknownTags[0].rawTag, '未知主題');
  });

  test('目錄尚待合併後課程聯集重算時，不授予學習或配對資格', () => {
    const resolved = {
      eligibility: {
        status: 'pending_post_alias_course_recount',
        interestLearningEligible: null,
        crossCourseMatchEligible: null,
      },
    };
    assert.equal(isEligibleForInterestLearning(resolved), false);
    assert.equal(isEligibleForCrossCourseMatch(resolved), false);
    assert.equal(isEligibleForInterestLearning(undefined), false);
    assert.equal(isEligibleForCrossCourseMatch({ eligibility: {} }), false);
    assert.equal(isEligibleForInterestLearning({ eligibility: { interestLearningEligible: 'true' } }), false);
  });

  test('已核對的 MySQL 資格快照與逐標籤統計一致', () => {
    const snapshot = interestTagCatalog.eligibilityRecount;
    const tags = interestTagCatalog.canonicalTags;
    assert.equal(snapshot.version, 'rag-tag-eligibility-2026-10-09-v1');
    assert.equal(snapshot.source, 'mysql-course-api');
    assert.equal(snapshot.reviewedOn, '2026-10-09');
    assert.match(snapshot.courseMembershipSha256, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.summary.catalogVersion, interestTagCatalog.catalogVersion);
    assert.equal(snapshot.summary.sectionCount, 3560);
    assert.equal(snapshot.summary.courseCount, 2004);
    assert.equal(snapshot.summary.canonicalTagCount, tags.length);
    assert.equal(snapshot.summary.unknownCourseTagCount, 0);
    assert.equal(snapshot.summary.skippedSectionCount, 0);
    assert.equal(snapshot.summary.interestLearningEligibleCount, 6736);
    assert.equal(snapshot.summary.crossCourseMatchEligibleCount, 2144);

    for (const tag of tags) {
      const eligibility = tag.eligibility;
      assert.equal(eligibility.status, 'reviewed_post_alias_course_recount');
      assert.equal(eligibility.version, snapshot.version);
      assert.ok(Number.isInteger(eligibility.courseCount) && eligibility.courseCount >= 1);
      assert.equal(eligibility.courseRatio, eligibility.courseCount / snapshot.summary.courseCount);
      if (eligibility.exclusionReason === 'explicit_generic' || eligibility.exclusionReason === 'too_common') {
        assert.equal(eligibility.interestLearningEligible, false);
        assert.equal(eligibility.crossCourseMatchEligible, false);
      } else {
        assert.equal(eligibility.interestLearningEligible, true);
        assert.equal(eligibility.crossCourseMatchEligible, eligibility.exclusionReason === null);
      }
      if (eligibility.exclusionReason === 'too_common') {
        assert.ok(eligibility.courseRatio > snapshot.summary.thresholds.maxCourseRatio);
      }
      if (eligibility.exclusionReason === 'single_course') assert.equal(eligibility.courseCount, 1);
    }
    assert.equal(tags.filter(tag => tag.eligibility.interestLearningEligible).length, 6736);
    assert.equal(tags.filter(tag => tag.eligibility.crossCourseMatchEligible).length, 2144);
    for (const [reason, count] of Object.entries(snapshot.summary.ineligibleReasonCounts)) {
      assert.equal(tags.filter(tag => tag.eligibility.exclusionReason === reason).length, count);
    }
  });

  test('執行期區分高頻、通用、單課與可配對標籤，別名沿用同一資格', () => {
    const ai = resolveInterestTag('AI');
    assert.equal(ai.eligibility.exclusionReason, 'too_common');
    assert.equal(ai.eligibility.courseCount, 97);
    assert.deepEqual(ai.eligibility, resolveInterestTag('人工智慧').eligibility);
    assert.equal(isEligibleForInterestLearning(ai), false);
    assert.equal(isEligibleForCrossCourseMatch(ai), false);
    const generic = resolveInterestTag('團隊合作');
    assert.equal(generic.eligibility.exclusionReason, 'explicit_generic');
    assert.equal(isEligibleForInterestLearning(generic), false);
    assert.equal(isEligibleForCrossCourseMatch(generic), false);
    const singleTag = interestTagCatalog.canonicalTags.find(tag => tag.eligibility.exclusionReason === 'single_course');
    const single = resolveInterestTag(singleTag.name);
    assert.equal(isEligibleForInterestLearning(single), true);
    assert.equal(isEligibleForCrossCourseMatch(single), false);
    const dataScience = resolveInterestTag('資料科學');
    assert.equal(dataScience.eligibility.courseCount, 40);
    assert.equal(isEligibleForInterestLearning(dataScience), true);
    assert.equal(isEligibleForCrossCourseMatch(dataScience), true);
  });

  test('未知標籤不會被誤認為目錄中的 canonical tag', () => {
    const resolved = resolveInterestTag('確定不存在的 rag_tag');
    assert.equal(resolved.status, 'unmapped');
    assert.equal(resolved.canonicalTagId, null);
    assert.deepEqual(resolved.categoryPaths, []);
  });
});
