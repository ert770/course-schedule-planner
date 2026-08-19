# Decisions

## ADR-001: Use MySQL for Course Runtime Data

Date: 2026-06-11

Context:
The system originally used `server/data/*.json` as MVP persistence. The project now has access to a MySQL database named `defaultdb` with course, section, review, and user profile tables.

Decision:
Runtime course APIs read from MySQL through `server/src/db/database.js` and `server/src/db/mysql.js`.

MySQL tables:

- `Courses`
- `Course_Sections`
- `Course_Reviews`
- `User_Profiles`

Consequences:

- `Course_Sections.section_id` is the API-level `course.id`.
- `Course_Reviews.selection_code` is joined to `Course_Sections.selection_code`; the joined `section_id` is exposed as `review.courseId`.
- Review sentiment and easiness use structured score columns such as `overall`, `coolness`, `sweetness`, and `workload`.
- `server/data/*.json` remains in use for data not represented by the provided MySQL schema.

## ADR-002: Keep Local JSON for Demo-Only Data

Date: 2026-06-11

Context:
The provided MySQL schema does not include auth passwords, chat history, or saved schedules.

Decision:
The following collections remain local JSON data:

- `users`
- `chat_history`
- `saved_schedules`
- demo or non-numeric `user_preferences`

Consequences:

- Login remains a local demo login until an auth-capable table exists.
- Saved schedules are not shared through MySQL yet.
- Numeric `/api/profile?userId=` requests can read `User_Profiles`.

## ADR-003: Keep Scheduling Rule-Based

Date: 2026-06-08

Decision:
Scheduling remains implemented in `server/src/skills/scheduler.js`. The LLM only interprets intent and calls tools.

Consequences:

- Hard constraints remain deterministic and testable.
- MySQL data is mapped into the existing scheduler course shape before scheduling.

## ADR-004: Gemini Provider

Date: 2026-06-08

Decision:
The AI agent uses `@google/genai` and `GEMINI_API_KEY`.

Consequences:

- Real API keys must stay in `.env`.
- `.env.example` only documents variable names.

## ADR-005: No GitHub Connector for This Project

Date: 2026-06-08

Decision:
GitHub operations use local Git and GitHub CLI only. Do not use the GitHub connector for this project.

## ADR-006: Courses With No Review Evidence Get the Population-Prior Score, Not Zero

Date: 2026-08-17

Context:
Roadmap #4 wires `Course_Reviews` into the scheduler's "easy_score" variant. Only 181 of 3560
sections (5.1%) have any review data. The naive approach — score a course with no evidence as 0
— would sink 95% of candidates to the bottom of every sort, which is not a neutral default; it is
an unsupported claim that "no data" means "this course is hard."

Decision:
`getEasyCourseScore(course)` returns `null` when a course has no `reviewEvidence`. Callers that
need a number for every candidate (`scoreCourse()`'s greedy-fill ordering) substitute
`neutralEasyScore`, defined as the m-estimate collapse at `n=0` — i.e. the population prior itself
(`courseReviewStats.getNeutralEasyScore`). Callers that report an aggregate to the user
(`getEasiness(plan)`, which feeds `preferenceBreakdown.easy`) average only over courses that do
have evidence, and return `null` if none do; the fraction of evidenced courses is reported
separately via `plan.reviewCoverage`.

Consequences:

- With zero review data available, `neutralEasyScore` is a constant offset applied identically to
  every course, so the greedy-fill ordering is unchanged from before this change — no regression
  risk for callers that never populate `constraints.courseReviews`.
- A course that is genuinely reviewed as difficult can still score below a completely unreviewed
  course. This is intentional: "unknown" is treated as more favorable than "known to be hard,"
  never the reverse.
- If review data is ever removed entirely, the population prior is `null` and `neutralEasyScore`
  falls back to the scale midpoint (50 on the 0–100 scale).

## ADR-007: m-estimate Shrinkage With m=5, Shared Between Scheduler and `/api/reviews/easy`

Date: 2026-08-17

Context:
`Course_Reviews.review_count` (the weight per row) ranges 4–8 in the current dataset. Ranking
courses by raw weighted-average easiness lets small samples dominate: a course with 4 reviews all
rated 5/5 would outrank a course with 8 reviews averaging 4.5/5, even though the second course's
score rests on twice the evidence. `GET /api/reviews/easy` (`reviewSearch.getEasyCourses`, now
`rankEasyCourses`) had exactly this problem independently of the scheduler.

Decision:
Both consumers shrink each course's raw easiness toward the population mean using an m-estimate,
`adjusted = (n * raw + m * prior) / (n + m)`, with `m = 5` — the median of the observed
`review_count` range, so a course with a typical review count is weighted roughly half on its own
data and half on the population. `shrinkEasiness()` lives in `skills/reviewStats.js` (the shared
statistics module, not `skills/courseReviewStats.js`) specifically so `reviewSearch.js` and
`scheduler.js` call the same function with the same population prior, computed from the same full
`Course_Reviews` table — not from whatever candidate subset either caller happens to be ranking.

Consequences:

- `GET /api/reviews/easy`'s ranking changed: it now sorts by `adjustedEasiness`, not raw
  `easiness`. Both fields are still returned. This is a deliberate behavior change to a shipping
  endpoint; no automated test or frontend UI previously depended on the old ordering (confirmed by
  grep before making the change), so the blast radius is the AI Agent's `get_easy_courses` tool
  output.
- `m = 5` is a defensible, stated choice, not a tuned parameter with no rationale. If the dataset's
  review-count distribution shifts materially, this value should be revisited together with the
  measurement that justified it.

## ADR-008: Plan-Level Easiness Averages Only Evidenced Courses; Rejected Alternative Was Coverage-Weighted Shrinkage

Date: 2026-08-17

Context:
`plan.preferenceBreakdown.easy` is a claim shown to the user ("this plan is 68% easy"). A plan can
contain courses with and without review evidence. Two designs were considered: (a) average only
over evidenced courses and separately report `reviewCoverage`, or (b) fold coverage into the
average itself, e.g. shrinking the whole plan's easiness score toward 0.5 in proportion to how few
of its courses are evidenced.

Decision:
Chose (a). `getEasiness(plan)` averages `getEasyCourseScore()` only over courses where it is
non-null, and returns `null` if no course in the plan has evidence; `plan.reviewCoverage` reports
`{ rated, total, ratio }` alongside it.

Rejected alternative (b) and why: coverage-weighted shrinkage conflates two different kinds of
uncertainty — a single course's sample size (already handled by ADR-007's m-estimate) and a plan's
fraction of evidenced courses — into one number. It would also pull every plan's easiness score
toward the same midpoint regardless of which plan is actually better-evidenced, which directly
works against Roadmap #10 (the five plan variants collapsing into near-identical schedules): the
whole point of wiring in real review data was to give variants more room to differ, not less.

Consequences:

- Consumers (frontend, AI Agent) must read `reviewCoverage` alongside `preferenceBreakdown.easy` to
  judge how trustworthy the percentage is; a bare 68% with 1/8 courses evidenced looks identical to
  68% with 8/8 evidenced unless both fields are shown together. This is documented in
  `docs/API_SPEC.md` and `docs/PROMPT_DESIGN.md`.

## ADR-009: Content-Preference Keywords Are Soft Score Adjustments, Not Hard Filters

Date: 2026-08-19

Context:
Roadmap #3. `hardConstraintReason()` hard-excluded candidates based on 8 flags
(`noMidterm`, `noGroupReport`, `discussion`, `weightDaily`, `practicalExam`, `finalReport`,
`englishTaught`, `learnMore`), each judged by matching a handful of keywords against
`course.description` — a 161-character-average free-text field, not a structured column. Measured
against the live 3560-course dataset, hit rates ranged from 0.1% to 97.6%. Two distinct failure
modes resulted: a "hit excludes" flag with a near-zero hit rate (`noMidterm`, 0.1%) almost never
excludes anything, so the preference is silently unmet while the system reports success; a "miss
excludes" flag with a near-zero hit rate (`weightDaily`, 1.7%) excludes nearly the entire candidate
pool — confirmed against a real student's 227-course pool, where it collapsed to 3 candidates
(1.3%), almost certainly too few to satisfy required-course placement.

Decision:
All 8 flags move out of `hardConstraintReason()` into an additive/subtractive score adjustment
inside `scoreCourse()`, computed by `getContentPreferenceScore()` against a shared
`CONTENT_PREFERENCE_RULES` table (flag, mode, label, keywords). The adjustment is applied
unconditionally across all 5 `PLAN_VARIANTS`, at the same point as the existing category-priority
and credits base score — these 8 flags were never variant-specific to begin with; softening them
preserves that property. The per-hit magnitude is `CONTENT_PREFERENCE_SCORE = 40`, matching
`INTEREST_KEYWORD_SCORE` exactly (both are "user-stated keyword preference" signals), well below a
single category-priority step (120) so no combination of content preferences can override the
required/core-elective/general-elective/gen-ed/outside-elective ordering.

Consequences:

- Candidate pools no longer collapse to near-zero from an unreliable keyword filter; the worst case
  is now "this preference barely influences ordering," not "scheduling fails."
- The 4 genuinely time-based checks in the same function (`noMorningClasses`, `noEveningClasses`,
  `blockedPeriods`, `lunchBreakFree`) are explicitly out of scope and remain hard — they judge
  structured `timeBlocks` facts, not free-text keyword matches, so they have no analogous hit-rate
  failure mode.
- This is not Roadmap #21's formal hard/soft constraint schema (`weight`, `relaxable`, `source`,
  `confidence` fields, an independent validator, a relaxation ladder). #21 depends on #3 (its own
  "開始前必須具備" already named this), not the reverse; #3 only fixes which of the 8 flags were
  misclassified as hard, it does not deliver #21's schema.

## ADR-010: Content-Preference Non-Matches Score Neutral Zero, Never a Penalty or Reward

Date: 2026-08-19

Context:
The 8 content-preference flags split into two modes: `avoid` (`noMidterm`, `noGroupReport` — a
match means the course has an undesired trait) and `prefer` (the other 6 — a match means the course
has a desired trait). For `prefer`-mode flags, the question of whether a non-match should be
penalized mirrors an already-settled question: should courses lacking a signal be treated worse
than courses confirmed to lack the trait? ADR-006 already answered this for review evidence ("no
data" ≠ "confirmed hard"). For `avoid`-mode flags the same question appears in mirror image: does a
keyword's *absence* from a 161-character description confirm the course truly lacks that trait, or
just that the description didn't mention it?

Decision:
Non-matches score exactly 0 for both modes — never a bonus for `prefer`, never a penalty avoided
for `avoid`-mode "confirmed clean." `getContentPreferenceScore()` only adds points on `matched &&
mode === 'prefer'` and only subtracts on `matched && mode === 'avoid'`; the non-matched branch is a
no-op in both cases.

Rejected alternative — rewarding `avoid`-mode non-matches (e.g. treat "描述沒提到期中考" as
confirmation of "沒有期中考" and add points): rejected because keyword absence is not evidence of
absence, and because doing so would produce a near-constant reward for the 99.9% of courses that
never mention "期中" for `noMidterm` — mechanically identical to the old hard-filter's "silent false
promise" failure mode, just expressed as a bonus instead of an implicit pass.

Consequences:

- With no content-preference flags set, `getContentPreferenceScore()` returns 0 for every course —
  a true no-op, so ordering for callers that never set these flags is byte-for-byte unchanged from
  before this change (confirmed: all 413 pre-existing tests pass unmodified).
- A course confirmed via keywords to have an undesired trait can still score below a course with no
  signal either way. This is intentional and mirrors ADR-006's "unknown is more favorable than
  known-bad, never the reverse."

## ADR-011: Content-Preference Signal Reliability Is Computed Once Per Candidate Pool, Not Per Plan

Date: 2026-08-19

Context:
ADR-008 computed `reviewCoverage` per plan, after `buildPlan()`, because it is a claim about what a
*specific* plan actually scheduled. Content-preference keyword hit rate is a different kind of
quantity: it is a property of the shared candidate pool and the matching mechanism itself, identical
across all 5 `PLAN_VARIANTS` regardless of which one becomes primary — closer in kind to
`unknownEligibilityNames`/`offTermNames`, the existing "candidate-layer, computed once" warnings in
`prepareCandidates()`.

Decision:
`computeContentPreferenceSignal()` and `buildContentPreferenceWarnings()` run once inside
`prepareCandidates()`, over the fully-gated candidate list, for every flag the caller actually
enabled. The resulting warnings flow into `prepared.warnings`, then into every plan's
`plan.warnings`, and are naturally deduplicated when `generateSchedule()` unions all 5 plans'
warnings via `[...new Set(...)]` — no extra bookkeeping needed to avoid a warning appearing 5 times.
Thresholds are `<5%` / `>95%`; validated against the measured hit-rate table, these two cutoffs flag
exactly `noMidterm` (0.1%), `weightDaily` (1.7%), and `learnMore` (97.6%) — the same three flags the
roadmap's own background analysis had already identified as broken (反向判定型/正向判定型) — while
leaving `noGroupReport` (5.5%, only 0.5 points above the low threshold), `discussion` (48.9%),
`practicalExam` (33.4%), `finalReport` (12.2%), and `englishTaught` (8.0%) untouched, matching the
same analysis's "已可運作" bucket.

Rejected alternative — computing per-plan like `reviewCoverage`: rejected because it would recompute
an identical number up to 5 times (wasted work) and because, unlike `reviewCoverage`, there is no
plan-specific quantity to report — the hit rate does not depend on which courses a particular
variant happened to schedule, only on which candidates exist at all.

Consequences:

- `prepareCandidates()`'s signature gains a `constraints` parameter (previously not received
  directly, only indirectly via the caller's own `buildStudentScope(constraints)` call.) Confirmed
  via grep that `prepareCandidates` is not exported and has exactly one call site, so this is a safe
  signature change.
- The 5%/95% thresholds are pinned constants matching the live dataset at the time of writing: if
  the review or course-description dataset shifts materially, these should be re-validated against
  a fresh hit-rate table the same way ADR-007's `m=5` should be revisited.
