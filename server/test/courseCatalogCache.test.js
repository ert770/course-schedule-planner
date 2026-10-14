import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COURSE_CATALOG_CACHE_TTL_MS,
  getCachedCourseCatalog,
  resetCourseCatalogCache,
} from '../src/services/courseCatalogCache.js';

test('CCC-1: 同時進來的請求共用同一次查詢，之後命中快取，過期才重查', async () => {
  resetCourseCatalogCache();
  let calls = 0;
  const loadCourses = async () => { calls += 1; return [{ code: `C${calls}` }]; };
  const [a, b, c] = await Promise.all([
    getCachedCourseCatalog({ now: 0, loadCourses }),
    getCachedCourseCatalog({ now: 0, loadCourses }),
    getCachedCourseCatalog({ now: 0, loadCourses }),
  ]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(await getCachedCourseCatalog({ now: 1000, loadCourses }), a);
  assert.equal(calls, 1);
  await getCachedCourseCatalog({ now: COURSE_CATALOG_CACHE_TTL_MS + 1, loadCourses });
  assert.equal(calls, 2);
  resetCourseCatalogCache();
});

test('CCC-2: 查詢失敗不留下快取，下一次重新查詢', async () => {
  resetCourseCatalogCache();
  let calls = 0;
  const loadCourses = async () => { calls += 1; if (calls === 1) throw new Error('db down'); return []; };
  await assert.rejects(getCachedCourseCatalog({ now: 0, loadCourses }), /db down/);
  assert.deepEqual(await getCachedCourseCatalog({ now: 0, loadCourses }), []);
  assert.equal(calls, 2);
  resetCourseCatalogCache();
});
