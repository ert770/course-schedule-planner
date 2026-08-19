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
