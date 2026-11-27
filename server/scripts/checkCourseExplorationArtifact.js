import assert from 'node:assert/strict';
import { loadCourseExplorationVectors } from '../src/services/courseExplorationEmbeddingService.js';
import { exploreForUser } from '../src/services/explorationService.js';
import { ACTIVE_TERM } from '../src/data/activeTerm.js';

const artifact = await loadCourseExplorationVectors();
assert.ok(artifact.available, `無法載入探索索引（${artifact.reason}）`);

const historicalCodes = [
  'ACTV1051', 'ADV1196', 'COMC1118', 'ENGL3125', 'GEH1125', 'GEK1028',
  'IND3411', 'LAND3032', 'MIS0855', 'MIS3505',
];
for (const code of historicalCodes) {
  const vector = artifact.index.entries.get(code)?.vectors?.name;
  assert.ok(vector?.length && vector.every(Number.isFinite) && Math.hypot(...vector) > 0,
    `索引缺少有效的課名向量（${code}）`);
}

// 使用正式索引中的課號與名稱，修課及班次為隔離資料，不連接 MySQL。
const startCode = 'MIS0855';
const candidateCode = 'IBUS2001';
const name = code => artifact.index.entries.get(code)?.name;
const result = await exploreForUser({ canonicalId: 'EXPLORATION_SMOKE' }, { favoriteCourseCode: startCode }, {
  loadProfile: async () => ({
    department: '資訊工程學系', gradeLevel: 3, className: '資訊三乙',
    courseHistory: [{
      courseCode: startCode, courseName: name(startCode),
      academicYear: 114, semester: 1, passed: true, credits: 3, graduationCategory: 'elective',
    }],
  }),
  loadCourses: async () => [{
    id: 1, name: name(candidateCode), catalogCourseCode: candidateCode, code: candidateCode,
    department: '國貿三甲', category: '選修', type: '選修', credits: 3, gradeLevel: 3,
    year: ACTIVE_TERM.academicYear, semester: ACTIVE_TERM.semester,
    timeBlocks: [{ dayOfWeek: 1, startPeriod: 3, endPeriod: 4 }],
  }],
});

assert.equal(result.favorites.find(item => item.courseCode === startCode)?.available, true);
assert.equal(result.emptyReason, null);
assert.equal(result.favorite?.courseCode, startCode);
const match = result.outside.items.find(item => item.courseCode === candidateCode);
assert.ok(match?.semanticMatch?.parts?.name > 0, '已修課未能完成課名比較');
console.log(`探索索引驗證通過（${artifact.index.entries.size} 門課，${startCode} → ${candidateCode}）`);
