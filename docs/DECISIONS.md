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

## ADR-012: Which Hard Constraints Are Relaxable

Date: 2026-08-20

Context:
Roadmap #21 requires a formal `hardConstraints`/`softPreferences` schema with `weight`,
`relaxable`, `source`, and `confidence` fields, and its acceptance criteria give two concrete
examples of how `relaxable` must be assigned: "盡量不排早八" (`noMorningClasses`) must be
relaxable when necessary, while "週一絕對不能上課" (a literal blocked period) must never be
relaxable. Every other existing hard constraint (time conflict, duplicate section, credit
ceiling, eligibility-unknown, already-taken, other-student-required, outside-elective-ineligible,
off-term, daily-course-cap) needed the same classification, not just the two named examples.

Decision:
`constraintSchema.js`'s `CONSTRAINTS` table classifies every hard constraint along one axis:
does it represent a real-world fact the student cannot violate regardless of preference (never
relaxable), or a stated comfort preference expressed with hard-sounding phrasing (relaxable)?
Only three constraints are `relaxable: true` — `NO_MORNING_CLASSES`, `LUNCH_BREAK_FREE`, and
`NO_EVENING_CLASSES` — all three time-of-day comfort preferences, not external facts. Everything
else is `relaxable: false`, including `BLOCKED_PERIODS` (a literal external commitment, e.g. a
job — the roadmap's own worked example), all eligibility/scope/academic-record checks (facts
about what the student is permitted or has already done, not preferences), and
`DAILY_COURSE_CAP` (deliberately left out of scope this round rather than reclassified without
evidence — see "Rejected/deferred" below).

`LUNCH_BREAK_FREE` and `NO_EVENING_CLASSES` were extended the same `relaxable: true`
classification as `NO_MORNING_CLASSES` even though the roadmap's acceptance criteria named only
the latter explicitly — they are the same *kind* of constraint (a single-period-range comfort
preference expressed as a boolean flag), and treating them inconsistently would have been an
unprincipled distinction with no textual or behavioral basis to justify it.

Rejected/deferred: reclassifying `DAILY_COURSE_CAP` as relaxable. It has no school-policy source
(see `scheduler.js`'s own comment: "沒有校方依據，預設不限制") and is arguably a comfort
preference too, but changing its relaxability was not requested and doing so without a concrete
scenario driving it risks scope creep on an already large change. Left `relaxable: false`,
unchanged from today's behavior.

Consequences:

- Every hard constraint now has an explicit, reviewable `relaxable` classification instead of the
  classification being implicit in which function happens to check it.
- Adding a new hard constraint in the future requires an explicit `relaxable` decision recorded in
  this table — it cannot silently default to relaxable or non-relaxable.
- If `maxCoursesPerDay` relaxability is wanted later, it is a schema-table change plus a new ADR,
  not a `scheduler.js` rewrite.

## ADR-013: Required Courses Are Unconditionally Exempt From Time-of-Day Comfort Preferences, Never From Blocked Periods

Date: 2026-08-20

Context:
Before this change, `hardConstraintReason()` applied `noMorningClasses`/`noEveningClasses`/
`lunchBreakFree` identically to every course, including a student's own formally-required
courses (`isRequiredForStudent(course, scope) === true`). A required course that happened to
start at period 1 with `noMorningClasses: true` set would be excluded and could make the whole
plan fail (see the pre-existing S10 test, which pins exactly this behavior for
`mustTakeCourseIds`). The user explicitly decided during roadmap #21 planning that a formally
required course must always be scheduled regardless of these three preferences — a required
course is not optional, and letting a comfort preference block it produces a worse outcome than
disclosing a preference violation.

Decision:
`addCourseToPlan()` accepts a `formallyRequired` option (set only in `buildPlan()`'s
`currentRequiredCourses` placement loop, where `isRequiredForStudent(course, scope)` is already
computed). When true, `hardConstraintReason()` is called with `{ skipTimePreferences: true }`,
which skips the `NO_MORNING_CLASSES`/`NO_EVENING_CLASSES`/`LUNCH_BREAK_FREE` checks — but not
`BLOCKED_PERIODS`, which is checked unconditionally regardless of `skipTimePreferences`. When the
exemption actually suppresses what would otherwise have been an exclusion, a warning is pushed
disclosing exactly which preference was overridden and for which course (e.g. `必修課「X」不符合
「不排早八」偏好，但必修優先，已排入課表。`) — never a silent placement.

The exemption is scoped narrowly to `isRequiredForStudent()`, a separate concept from
`options.required` (which remains tied to `requiredIds` = `selectedCourseIds` ∪
`mustTakeCourseIds`, exactly as before). A user-picked "must take" course that is not the
student's actual department-required course does **not** receive this exemption and is still
excluded by these three checks exactly as before — this is why S10 (which uses
`mustTakeCourseIds`) needed no changes and continues to pass unmodified; a parallel new test
(X14) pins the same non-exemption from the opposite direction.

`BLOCKED_PERIODS` is excluded from the exemption on purpose: it represents a literal external
commitment (the roadmap's own example is a job) that makes physical attendance impossible
regardless of how important the course is. Making a required course "win" against a real
scheduling conflict would produce an unattendable schedule, not merely an uncomfortable one.

Rejected alternative — applying the exemption via the general opt-in relaxation ladder
(`allowRelaxation`) instead of a separate unconditional mechanism: rejected because the user
explicitly wants required-course scheduling to never depend on an opt-in flag nobody sets by
default — a required course being silently unschedulable because a caller forgot to pass
`allowRelaxation: true` would be a worse failure mode than the one this ADR fixes. See ADR-014
for why the ladder is opt-in for the separate elective-side use case it does serve.

Consequences:

- Placed course objects gain a `formallyRequired: boolean` field (always present, not just when
  true) recording whether this specific placement used the exemption — this lets
  `scheduleValidator.js`'s self-check (see below) and any external consumer inspect exactly which
  courses were exempted without recomputing scope.
- `scheduleValidator.js`'s `validateScheduleAgainstConstraints()` deliberately does *not*
  recompute `isRequiredForStudent()` itself — it has no `scope` argument. It only honors the
  `formallyRequired` marker already present on a course object. A schedule submitted externally
  (e.g. via `/api/schedule/validate`) without this marker is checked at full strictness — a
  conservative default for arbitrary external input, not an oversight.
- `generateSchedule()`'s own internal self-check (ADR still to follow in the scheduling-logic
  docs) calls the validator on its own output, which already carries `formallyRequired` markers
  from `addCourseToPlan()` — so a legitimately-exempted required course does not trip a false
  "hard constraint violation" in the self-check.

## ADR-014: Relaxation Ladder Is Opt-In, User-Ordered, and Independent of the Required-Course Exemption

Date: 2026-08-20

Context:
Roadmap #21 asks for "soft constraint 逐級放寬順序與使用者可否接受的確認流程" (a graduated
relaxation order for soft-sounding constraints, with a user-confirmable flow). This is a
different problem from ADR-013's required-course exemption: even after required courses are
guaranteed to schedule, the *elective* side of a plan can still fail to reach `minCredits` if
`noMorningClasses`/`lunchBreakFree`/`noEveningClasses` collectively filter out too many elective
candidates. Automatically relaxing these without telling the user would violate this project's
established "never silently assume" discipline (ADR-006, ADR-009, ADR-010).

Decision:
A new `constraints.allowRelaxation` boolean, default `false`, gates the entire mechanism — no
existing caller sets this flag today, so default behavior (S1-S10, N1-N15, and every existing
`/api/schedule/generate` caller) is provably unchanged. When enabled and the strict pass fails,
`generateSchedule()` walks `constraints.timePreferencePriority` — an array of constraintIds the
*user* supplies, not a value the system infers — falling back to `constraintSchema.js`'s
`DEFAULT_TIME_PREFERENCE_PRIORITY` only when the user did not specify one. Only constraints
tagged `relaxable: true` with a corresponding `flag` field in the schema ever enter this
iteration; `BLOCKED_PERIODS` and every non-relaxable constraint are structurally absent from the
list, not excluded by a runtime check that could be miscoded. Each relaxation step is recorded in
the response's `relaxedConstraints` array and echoed into `warnings` as a disclosure string, so a
consumer reading only `warnings` (the pre-#21 contract) still sees what changed.

The relaxation order being user-suppliable, not hardcoded, was an explicit requirement from the
user during roadmap #21 planning — different students weight "no early classes" against "lunch
break" differently, and a fixed system-wide order would silently favor one axis over another for
everyone.

Rejected alternative — merging this into ADR-013's required-course exemption as one mechanism:
rejected because the two solve different problems with different safety properties. The required-
course exemption must be unconditional (a required course cannot be allowed to fail to schedule
just because a caller forgot a flag); the elective-side relaxation ladder must be opt-in (silently
handing back a schedule with different soft preferences than the ones requested, for *optional*
courses, is exactly the kind of silent reinterpretation this project's ADRs have consistently
rejected). Collapsing them into one mechanism would have forced one of these two safety
properties to lose.

Consequences:

- `buildScheduleConstraints()` gains `allowRelaxation` (via the existing `pickFlag` helper, so
  `false` is a valid explicit override like every other boolean flag) and `timePreferencePriority`
  (via `pickList`, so an empty array falls back to the schema default the same way every other
  array-typed preference falls back to a saved value).
- The ladder only retries the `required_first` plan variant, not all five — the cheapest variant
  most likely to satisfy required-course coverage, since the ladder's entire purpose is unblocking
  `minCredits`, not re-optimizing every variant's own bias.
- A relaxed successful response carries `relaxedConstraints` in addition to every existing
  success-path field (`schedule`, `plans`, `warnings`, etc.) — additive, not a replacement shape.

## ADR-015: Three Fixes From the Adversarial Security Review of the `backend` Branch

Date: 2026-08-20

Context:
A Codex adversarial review of the `backend` branch against `main` (117 files, ~12k insertions)
found three issues severe enough to mark the branch "needs-attention": student chat conversations
committed to Git, a profile migration script that could silently bind one student's data to
another student's account, and a production session-secret fallback that fails unpredictably
instead of failing at startup. All three are fixed in this branch; none required design changes
outside the flagged files.

Decision (three independent fixes):

**1. Chat history is no longer tracked in Git.** `server/data/chat_history.json` is the runtime
persistence target for `memoryService.js`'s `addChatMessage()` — it is not a demo fixture, it
accumulates real conversation content keyed by a stable student ID and timestamp on every chat
turn, because `chat_history` is absent from `database.js`'s `MYSQL_COLLECTIONS` set and therefore
always goes through the local-JSON path regardless of whether MySQL is configured. It was added to
`.gitignore` and `git rm --cached`, so the file remains on disk for the runtime fallback path but
is never staged again. The file's four prior commits (going back to the initial commit) still
contain historical snapshots in Git history — removing those requires a history rewrite and a
force-push to the shared GitHub remote, which was deliberately **not** done as part of this fix; it
is a separate, more disruptive decision the repository owner needs to make explicitly (it would
require every other clone to be discarded and re-cloned).

**2. The `student_id` profile-migration backfill is now transactional and verifies every row.**
`server/scripts/profileSchemaMigration.js`'s `backfillStudentIds()` previously issued one `UPDATE
… WHERE user_id = ?` per row from `server/data/users.json`, one call at a time, each auto-committed
independently, with no check on how many rows each `UPDATE` actually affected. Two failure modes
followed directly: a mid-run error left the shared `User_Profiles` table partially migrated with no
way to know which rows had and hadn't been touched, and a `user_id` that existed in the local
`users.json` snapshot but pointed at a *different* student's row in the shared MySQL instance (or
didn't exist there at all) would still "succeed" silently — the local file's numeric `id` was
trusted as authoritative with no verification against the actual shared database it was mutating.

The fix does not — and structurally cannot — *prove* that a local `users.json` row and a shared
`User_Profiles` row with the same numeric id represent the same real student: the pre-migration
schema has no other column (email, name, or any identity signal) common to both sides to
cross-check against, and `student_id` itself is the column being populated for the first time, so
it cannot yet be used to look itself up. Given that constraint, the fix makes the assumption
impossible to miss and mechanically fails safe instead of mechanically failing silent:
`server/src/db/mysql.js` gained a `withTransaction()` helper (a single pooled connection,
`beginTransaction`/`commit`/`rollback`), and every `UPDATE` inside `backfillStudentIds()` now
asserts `affectedRows === 1`, throwing immediately (rolling back the entire transaction, leaving
zero rows touched) the moment any row doesn't match exactly once. The dry-run and `--apply` paths
now both print the full `user_id → studentId, className` mapping table before anything is written,
prefixed with an explicit warning that this correspondence is an operator-verified assumption, not
something the script can confirm on its own.

**3. Production refuses to start without a real, shared `SESSION_SECRET`.**
`sessionService.js`'s `getSecret()` silently generated a random 32-byte secret per process when
`SESSION_SECRET` was unset, logging only a warning. In production this is a correctness bug wearing
the costume of a convenience feature: every server restart invalidates every logged-in session, and
every replica behind a load balancer signs cookies with a *different* random secret, so requests
routed to a different replica than the one that issued the cookie fail authentication — an
intermittent, hard-to-reproduce 401 pattern that looks like a client bug, not a missing
environment variable. `assertSessionSecretConfigured()` is a no-op outside `NODE_ENV=production`
(preserving today's zero-config local/demo behavior), and in production requires `SESSION_SECRET`
to be set and at least 32 characters, throwing a descriptive error otherwise. `app.js`'s
`startServer()` calls it before `app.listen()`, so a misconfigured production deployment fails at
process startup — a clear, immediate, loud failure — rather than starting successfully and failing
unpredictably per-request once traffic and multiple replicas are involved.

Rejected alternative for #3 — checking inside `getSecret()` at first use instead of at startup:
rejected because it would let the server report itself as healthy and accept traffic before the
first session-dependent request reveals the misconfiguration, which is a strictly worse failure
mode for an operator to diagnose than a startup crash with a clear message.

Consequences:

- `server/data/chat_history.json` staying `git rm --cached` but present on disk means a fresh clone
  of the repository after this commit will not have the file; `memoryService.js`/`database.js`
  already handle a missing collection file as an empty collection (`readCollection()`'s
  `fs.existsSync` guard), so this requires no additional runtime change.
- The migration script's new transactional path means a partial `--apply` run is no longer
  possible in principle — either all rows in `backfillPlan()` are backfilled, or the shared
  database is left exactly as it was before the run started.
- `assertSessionSecretConfigured()` has no effect on `npm test`, local `npm run dev`, or any
  existing test file, none of which set `NODE_ENV=production`; `server/test/session.test.js`
  gained direct unit tests (I5) for the function itself, independent of a real server process.
- Deploying this branch to any environment that sets `NODE_ENV=production` without also setting a
  sufficiently long `SESSION_SECRET` will now fail to start — this is a deliberate breaking change
  for that specific misconfiguration, not a regression to work around.
