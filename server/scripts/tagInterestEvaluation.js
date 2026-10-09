// Read-only evaluation harness for rag-tag-interest-v1.
// Synthetic personas never connect to MySQL or enter the real-data summary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  assessRealEvaluationReadiness,
  evaluateSyntheticTagInterestCases,
} from './lib/tagInterestEvaluation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '..', 'test', 'fixtures', 'tagInterestEvaluationCases.json');
const checkRealReadiness = process.argv.slice(2).includes('--check-real-readiness');
let closePool = async () => {};

async function readRealReadiness() {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });
  const database = await import('../src/db/mysql.js');
  closePool = database.closePool;
  const rows = await database.queryRows(`
    SELECT
      COUNT(*) AS snapshotEventCount,
      COUNT(DISTINCT subject_id) AS subjectCount,
      SUM(
        (event_type = 'course_selected' AND source IN ('explicit_selection', 'system_recommendation'))
        OR event_type IN ('course_favorited', 'recommendation_accepted')
        OR (event_type = 'course_rated' AND rating >= 4)
        OR (event_type = 'course_withdrawn' AND feedback_reason = 'content')
      ) AS rankingOutcomeCount,
      (
        SELECT COUNT(*)
        FROM (
          SELECT subject_id
          FROM Interaction_Events
          WHERE tag_interest_snapshot_json IS NOT NULL
            AND expires_at > UTC_TIMESTAMP(3)
            AND JSON_UNQUOTE(JSON_EXTRACT(tag_interest_snapshot_json, '$.requiredStatus')) = 'not-required'
            AND JSON_LENGTH(JSON_EXTRACT(tag_interest_snapshot_json, '$.evidenceTagIds')) > 0
            AND (
              (event_type = 'course_selected' AND source IN ('explicit_selection', 'system_recommendation'))
              OR event_type IN ('course_favorited', 'recommendation_accepted')
              OR (event_type = 'course_rated' AND rating >= 4)
              OR (event_type = 'course_withdrawn' AND feedback_reason = 'content')
            )
          GROUP BY subject_id
          HAVING COUNT(*) >= 2
        ) AS subjects_with_two_outcomes
      ) AS subjectsWithTwoOutcomes
    FROM Interaction_Events
    WHERE tag_interest_snapshot_json IS NOT NULL
      AND expires_at > UTC_TIMESTAMP(3)
      AND JSON_UNQUOTE(JSON_EXTRACT(tag_interest_snapshot_json, '$.requiredStatus')) = 'not-required'
      AND JSON_LENGTH(JSON_EXTRACT(tag_interest_snapshot_json, '$.evidenceTagIds')) > 0
  `);
  return assessRealEvaluationReadiness(rows[0] ?? {});
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const synthetic = evaluateSyntheticTagInterestCases(fixture);
  const result = {
    generatedAt: new Date().toISOString(),
    modelVersion: synthetic.modelVersion,
    synthetic,
    realDataReadiness: checkRealReadiness ? await readRealReadiness() : {
      checked: false,
      note: '使用 --check-real-readiness 才會執行唯讀 aggregate 查詢。',
    },
    claims: {
      syntheticAccuracy: false,
      realRecommendationQuality: false,
    },
  };
  console.log(JSON.stringify(result, null, 2));
  if (!synthetic.passed) process.exitCode = 1;
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
