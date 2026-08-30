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

**Superseded by ADR-020 (2026-08-30).**

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

## ADR-016: Define Interaction Events Before Collecting Them

Date: 2026-08-21

Context:
Roadmap #29 must define enough event semantics to distinguish a course the user never saw from one
they rejected, and a required-course acceptance or time-conflict removal from genuine preference
feedback. However, roadmap #2 is the task that instruments the product, and #33 must first define
consent, pseudonymization, retention, deletion, and research-export rules. Persisting real events
inside #29 would bypass both dependencies and create a user-linked dataset before its privacy rules
exist.

Decision:

1. `interactionEventSchema.js` is a pure, versioned contract only. It normalizes, migrates,
   validates, creates server-authoritative event envelopes, derives idempotency keys, and resolves
   append/duplicate/conflict outcomes against an injected array. It exposes no Express route and
   writes neither MySQL nor `server/data/*.json`.
2. `userId`, `eventId`, `timestamp`, `schemaVersion`, and `idempotencyKey` are server-owned.
   `createInteractionEvent()` always overwrites same-named client input with authenticated identity
   and server-generated values. #33 will decide how the canonical ID becomes a pseudonymous
   analytics ID before #2 persists anything.
3. Idempotency is scoped by `(userId, idempotencyKey)`. The SHA-256 key is derived from
   `requestId + actionId + eventType + plan/course subject`; it deliberately excludes `eventId` and
   `timestamp`, which legitimately change when the same React action is retried. A matching key and
   matching logical payload returns the original event; a matching key with changed context is a
   conflict, not an overwrite.
4. Exposure records both the ordered candidate set and the actually displayed subset, using only
   stable course/section identifiers. Required, explicit, system-recommended, and exploration
   sources stay distinct. Removal/withdrawal reasons use a fixed enum and do not accept free text.

Rejected alternative — immediately add an interaction-events API and local JSON collection:
rejected because it would be roadmap #2 data collection before roadmap #33 consent and retention
rules. A local file is not harmless: the existing chat-history incident showed that runtime JSON
can accumulate real student-linked content and accidentally enter Git history.

Consequences:

- Roadmap #29 can be completed and unit-tested without collecting a single real interaction.
- Roadmap #33 is now unblocked and owns the privacy/pseudonymization boundary; roadmap #2 remains
  blocked until #33 is complete.
- Current UI operations are not instrumented by this change. Favorite, acceptance, removal,
  withdrawal, and exploration event types are forward contracts only where the UI does not yet
  expose those actions.
- `recommendationReasonVersion` remains explicitly `null` until roadmap #26 defines a versioned
  reason object; absence is recorded honestly instead of inventing a version.

## ADR-017: Separate Raw Chat, Structured Preferences, and Analytics Consent

Date: 2026-08-22

Context:
Roadmap #2 cannot collect student-linked interaction data until the product distinguishes data needed
to provide the service from data used to learn personal weights or conduct research. The existing
`chat_history.json` stored canonical student IDs and plaintext conversation indefinitely, and Agent
logs repeated message/profile/thought/tool content. Treating all of this as one generic
"personalization dataset" would make purpose limitation and deletion impossible.

Decision:

1. Consent is layered into required `service_processing` and two optional, default-off purposes:
   `personalization_learning` and `aggregate_research`. Consent decisions are append-only and bound
   to policy version `2026-08-22.v1`.
2. Raw Chat is encrypted per record with AES-256-GCM and expires after 30 days. It exists only for
   conversation continuity and is excluded from learning and research. A preference explicitly
   confirmed in Chat may still be saved through the existing structured Profile tool; clearing Raw
   Chat therefore does not erase Profile preferences.
3. Privacy storage uses `v1:HMAC-SHA-256(secret, canonicalId)` subject IDs. The analytics secret and
   AES key are independent deployment secrets. Persistent analytics records must not store both the
   canonical ID and subject ID.
4. Research output is aggregate-only with k ≥ 5. Raw Chat, complete course histories, and row-level
   interaction events are prohibited from research exports.
5. Personal endpoints use a current-version service-consent guard when enforcement is enabled.
   Shared-MySQL migration and destructive legacy-chat cleanup require separate explicit confirmation;
   neither is performed merely by deploying source code.

Consequences:

- #2 may use the consent guard and subject-ID boundary after migration/config rollout; it still owns
  actual instrumentation, event persistence, and idempotent append.
- The runtime no longer reads or writes `server/data/chat_history.json`; the existing file remains
  untouched until its dry-run report is reviewed and deletion is explicitly approved.
- AI logs contain operational metadata only. Gemini receives the minimum structured context needed
  for the response and no display name.
- Account/data deletion needs a short-lived single-use token and exact confirmation phrase. It deletes
  service data but retains minimal consent/audit records for 365 days.

## ADR-018: Instrument Interactions Without Creating a Consent Wall or a Re-identifiable Dataset

Date: 2026-08-26

Context:
Roadmap #2 must actually record what the system showed, what the user chose, and why they dropped
courses — the data prerequisite for #30, #5B, #6, #7, #9 and #32. #29 fixed the event contract and
#33 fixed consent, pseudonymization and retention, so the remaining decisions are about how
instrumentation behaves in the product: what happens when the optional consent is off, what the
storage layer is allowed to hold, how duplicates are prevented, and what counts as acceptance.

Decision:

1. `personalization_learning` is an **optional** purpose that defaults to off. `POST /api/interactions`
   therefore does **not** use the `requireConsent` middleware. Without consent it returns
   `200 { recorded: false, reason: 'CONSENT_NOT_GRANTED' }` and writes nothing, instead of the
   `428 CONSENT_REQUIRED` used for the required `service_processing` purpose. A 428 means "the user
   must go deal with this first", which would turn an optional analytics choice into a consent wall.
   The removal-reason dialog is likewise not shown to users who have not opted in: asking a question
   whose answer is discarded wastes the user's time.
2. The storage layer holds `subject_id` only. `createInteractionEvent()` produces an envelope with the
   canonical student ID per #29, but it is swapped for the #33 HMAC subject ID before the INSERT and
   never persisted. `versionSnapshot.profileSchemaVersion` and `modelVersion` are overwritten with the
   server's current values — a version snapshot is a fact about the system, not something a caller
   may declare.
3. Idempotency is enforced twice: `resolveIdempotentAppend()` in the application layer, and a
   `(subject_id, idempotency_key)` UNIQUE index in MySQL. The application check alone loses races
   between concurrent retries of the same action; a duplicate-key error is reported as `duplicate`,
   never retried or overwritten.
4. Interaction logging is a side channel. Failure to record must never fail an add, a removal, a
   schedule generation or a chat turn. The client is fire-and-forget and swallows errors into a
   console warning. **But a side channel may not lie about its own outcome**: `logInteraction()`
   returns a never-rejecting promise carrying the real result, and the post-schedule confirmation
   bar words itself from that result. Consent-off and write-failure both say the feedback was not
   stored, instead of claiming it will shape future recommendations.
5. `recommendation_accepted` comes only from an explicit confirmation — the "符合" button, or the
   Agent's `record_schedule_feedback` after the user answered. **Saving a schedule is not treated as
   acceptance**: saving a draft is ambiguous. No answer is recorded as no acceptance, not as a
   negative. The schedule's contents are already covered by `course_selected`, so nothing is lost.
6. This product maps `course_withdrawn` to "dropping a course that was on the schedule". There is no
   integration with the university's enrolment system, so #29's literal "withdrew after formally
   enrolling" has no observable counterpart; roadmap #2's 「加選後退選」 is carried by this event.
   `course_removed` stays an unused forward contract for "rejecting a recommendation without it ever
   entering the schedule", which no current screen offers.

7. Writing an event is guarded by the subject's withdrawal state, checked under
   `SELECT ... FOR UPDATE` in the same transaction as the INSERT, and `DELETE /api/privacy/data`
   marks the subject withdrawn **before** deleting anything. Consent rows are retained for 365 days
   after deletion, so a consent check alone still passes post-deletion: an in-flight request that
   had already passed it could otherwise land after the delete completed, recreate the subject row,
   and leave personal data behind an endpoint that reported success. With this ordering a concurrent
   write either commits before the withdrawal (and is removed by the delete that follows) or blocks
   on the row lock and is rejected.
8. Feedback provenance is validated against the recorded `recommendation_exposed` event, not against
   string shape. The Agent is a language model and will fabricate plausible identifiers; checking
   only "is this a UUID", "does planId have the right prefix" and "does this section exist somewhere
   in the catalog" is not validation. A `requestId` must belong to this subject, an accepted `planId`
   must be the plan that was actually shown, and every rejected section must appear in that
   exposure's `displayedSet` — a user cannot reject a course they were never shown.

Rejected alternative — a separate recommendation-snapshot table for provenance: rejected because
`recommendation_exposed` already records the subject, requestId, plan and displayed courses. A second
copy of the same fact drifts, and it would create new personal records for users who never opted in
to personalization.

Rejected alternative — guard the endpoint with `requireConsent(PERSONALIZATION_LEARNING)`: rejected
because the resulting 428 is indistinguishable, to the client, from the service-consent wall, and the
UI would have to special-case an error path for a state that is entirely legitimate.

Rejected alternative — emit `recommendation_accepted` on save as well as on confirmation: rejected
because the same plan would then be counted twice by #30 through two different actions, and a saved
draft would be scored as an endorsement.

Consequences:

- #2 is complete; #30 is unblocked and now owns turning these events into weights.
- Schedule responses gained `requestId` and per-plan `planId`/`variantId`. Without them a
  `recommendation_exposed` event could not identify which recommendation it described, since
  `plan.id` is only a variant name reused across every generation.
- Exposure stores 227 candidates against 8 displayed courses in the demo account's real data; the
  difference is exactly what stops #30 from reading "never shown" as "seen and rejected".
- Users who never opt in generate no rows at all, and are never shown the reason dialog.
- Feedback now requires a prior exposure event. Legitimate feedback is rejected if the client never
  reported the exposure (e.g. a network failure). That is the safe direction: a missing label costs
  #30 one data point, a fabricated label corrupts what it learns.

## ADR-019: Server-Authoritative Exposure, Consent Race Closure, and Honest Duplicate Reporting

Date: 2026-08-26 (second adversarial review round)

Context:
A second `/codex:adversarial-review` pass against `98bf7ac..218358a` (the roadmap #2 commit, itself
already a first-round adversarial-review fix) found four further issues, two rated high enough to
recommend not shipping: consent enforcement had its own unguarded race (distinct from the account
deletion race ADR-018 already closed), the entire ingestion boundary trusted client-asserted
recommendation provenance rather than validating it, concurrent conflicting writes were silently
misreported as harmless duplicates, and a client-only signal was used to label courses as
curriculum-required. All four are confirmed against the actual code paths, not assumed from the
review text.

Decision:

1. **Consent has its own race, independent of account deletion.** `hasPersonalizationConsent()`
   checked `granted` but not `policyVersion`, so consent recorded under a retired policy version
   remained valid forever — inconsistent with `service_processing`, which `getConsentStatus()`
   already treats as outdated once the policy version changes.
   `hasCurrentPurposeConsent(subjectId, purpose, connection)` now checks both, and `insertEvent()`
   re-checks it a second time inside the same transaction and row lock already used for the
   withdrawal check (`SELECT ... FOR UPDATE` on `Privacy_Subject_State`). `recordConsentChoices()`
   already acquires that same lock via `touchSubject()`'s `INSERT ... ON DUPLICATE KEY UPDATE`
   before writing new consent rows, so a write and a revoke on the same subject now always
   serialize: whichever transaction's lock acquisition happens second necessarily observes the
   other's already-committed result. Verified against real MySQL with genuinely concurrent
   connections (`Promise.all` racing a write against a revoke, repeated until both interleavings were
   observed) — every trial resolved to either a clean `append` (write legitimately preceded the
   revoke) or a clean rejection (write correctly saw the revoked state), never a write landing after
   a revoke had already returned to its caller.
2. **Client-submitted exposure is not exposure.** `POST /api/interactions` passed caller-controlled
   drafts straight into storage; format validation (UUID shape, enum membership, `displayedSet ⊆
   candidateSet`) is not proof that a recommendation was ever generated or shown. Any authenticated
   account could submit a fabricated `recommendation_exposed` row and then reference it from
   `recommendation_accepted` / `course_withdrawn`, satisfying the round-one `findExposure()` check
   against data the same caller invented. `recommendation_exposed` is now written only by
   `services/scheduleService.js`, at the moment it computes a schedule, from the schedule it actually
   produced — `recordInteractionEvents()` accepts this event type solely when called with
   `{ allowExposureWrite: true }`, a flag no route ever passes through from client input. A second,
   separate table for this was considered and rejected for the same reason ADR-018 rejected a
   recommendation-snapshot table: `recommendation_exposed` is already the record #30 needs to keep,
   and a parallel copy only drifts.
3. **Provenance validation moved from one caller into the write path itself.** The first review round
   added exposure-provenance checking only to `scheduleFeedbackService` (the Agent tool's path). The
   confirmation bar's "符合" button and the removal-reason dialog call `POST /api/interactions`
   directly and were completely unvalidated — the far more used, non-Chat surface was the one left
   unguarded. `recordInteractionEvents()` itself now requires, for `recommendation_accepted` and for
   `course_withdrawn` sourced as `system_recommendation`, a matching `recommendation_exposed` row for
   that subject and `requestId`, with the accepted `planId` matching the one actually shown and any
   withdrawn `sectionId` present in that exposure's `displayedSet`. This applies uniformly regardless
   of caller, so no future write path can reintroduce this gap by skipping a helper function.
4. **Duplicate-key collisions are re-verified, not assumed harmless.** `resolveIdempotentAppend()`'s
   pre-insert check can be raced: two requests sharing an idempotency key but differing in
   `feedbackReason` (or other fields excluded from the key) can both observe "not yet present" and
   both attempt to insert; only one wins the UNIQUE constraint. The loser was previously reported as
   `duplicate` unconditionally, implying its payload matched what got stored, when it did not. The
   `ER_DUP_ENTRY` handler now reloads the winning row and re-runs `resolveIdempotentAppend()` against
   it, reporting `conflict` when the payloads differ. The memory store used in tests now enforces the
   same `(subject, idempotencyKey)` uniqueness MySQL does, so this path is exercised by an actual
   race (`Promise.all`) in the automated suite, not only by a real-MySQL manual check (which also
   confirmed the same behavior).
5. **`course.category === '必修'` is not "required for this student."** `interactionLog.js`'s
   `courseSource()` used exactly the field `scheduler.js`'s own `CATEGORY_PRIORITY` logic and
   `isRequiredForStudent()` exist to correct — a cross-department 必修 course is demoted for
   scheduling purposes but was still being labeled `source: required` for interaction logging,
   contaminating exactly the signal #29's `source` enum exists to keep clean. `courseSource()` now
   reads `course.formallyRequired`, the field `addCourseToPlan()` already attaches to every course
   placed via the student's actual required-course loop (`skipTimePreferences`, driven by
   `isRequiredForStudent()`). Manually-selected courses (never processed by the scheduler) carry no
   such field and correctly fall through to `explicit_selection`.
6. **Ingestion gained a rate limit and a daily quota.** The 50-events-per-request cap bounds a single
   call, not an account. `utils/rateLimiter.js` adds an in-process fixed-window throttle (20
   requests/minute/subject) for burst protection, and `wouldExceedDailyQuota()` adds a MySQL-backed
   count (2000 events/day/subject) that survives a process restart. No new infrastructure (Redis, a
   dependency) was introduced — the project runs as a single Node process and the existing
   `Interaction_Events` table already answers the quota query.

Rejected alternative — a full server-side provenance system for every event type (`course_viewed`,
`course_favorited`, `course_selected`, `schedule_regenerated`): rejected as disproportionate to what
was found. These event types have no server-side "ground truth" to validate against in the first
place — a user can view or favorite any catalog course, recommended or not — so a provenance check
there would only be able to confirm catalog existence, not intent. The two event types where a false
claim of system origin actually corrupts a downstream training signal (`recommendation_accepted`,
`system_recommendation`-sourced `course_withdrawn`) are covered.

Consequences:

- `ScheduleContext.jsx` no longer exposes `logRecommendationExposed`; `DashboardPage`/`SchedulePage`
  pass `surface`/`trigger` in the `POST /api/schedule/generate` request body instead, and the server
  includes them in the exposure event it writes itself.
- `POST /api/schedule/generate` and the `run_csp_scheduler` Agent tool both flow through
  `scheduleService.generateForUser()`, so both surfaces get server-written exposure through the same
  code path with no duplicated logic; Chat's `surface`/`trigger` are hardcoded server-side rather than
  left to the model.
- A consenting account generating a schedule now incurs one additional MySQL write (the exposure
  event) inside the synchronous `/api/schedule/generate` request; this is wrapped fail-open, matching
  `loadCourseReviewsSafely()`'s existing pattern in the same file — a write failure logs a warning and
  the schedule response is unaffected.
- Legitimate feedback is now rejected if the corresponding exposure write failed or never happened
  (e.g. the user was not consented at generation time but consents before responding to the
  confirmation bar). This is the same accepted tradeoff as point 4 above: a missing label costs one
  data point, a fabricated one corrupts what #30 learns from it.

## ADR-020: OpenAI Responses API With Native Tool Calling

Date: 2026-08-30

Supersedes ADR-004.

Context:

`gemini-2.5-pro` was retired by Google for new users, so `/api/chat` had been
returning `404 ... no longer available to new users` since at least 2026-08-11.
The whole chat path was dead, which is why roadmap #2's post-scheduling
confirmation had never once been exercised in a browser. A course-provided
OpenAI key made the path recoverable.

Decision:

1. The AI agent uses the `openai` SDK with `OPENAI_API_KEY` and `OPENAI_MODEL`.
   The model id is never hard-coded — swapping models is deployment config.
2. Tool calling is **native**, not text-parsed. `promptService.getAgentTools()`
   declares six tools as JSON Schema; the `[LLM_Thought]` / `[ToolCall]` regex
   protocol and the `final_answer` pseudo-tool are gone.
3. The transport is the **Responses API** (`/v1/responses`), not Chat
   Completions. `gpt-5.6-luna` is a reasoning model and rejects function tools
   on `/v1/chat/completions` unless `reasoning_effort` is `none`; keeping
   reasoning matters more here than staying on the older endpoint, because the
   agent's job is multi-step (decide what is missing → query → schedule →
   follow up on the result).

Consequences:

- Parameter legality is enforced by the API instead of by model self-discipline:
  `feedbackReason` is an enum, `requestId` is required, unknown properties are
  rejected. This was previously only a sentence in the prompt.
- Requests send no `temperature` (reasoning models do not take it).
- Tool results must be projected before being fed back. The full scheduler
  result serializes to 838 KB and blew the context window on the second
  scheduling request; `summarizeScheduleForModel()` cuts it to ~9.7 KB while
  the frontend still receives the full object.
- The prompt now carries a server-supplied `requestId` and section-id table for
  the last chat recommendation. Tool results are not persisted by
  `saveChatExchange()`, so without this the model has no legal identifiers on
  the next turn and `record_schedule_feedback` can never succeed. Provenance
  validation in `scheduleFeedbackService` is unchanged — this only puts facts
  the database already holds back in the model's view.
- The privacy policy version was bumped (see ADR-021); users consented to their
  chat reaching Gemini, not OpenAI.
- `@google/genai` stays in `package.json` only because `src/testFunc*.js` still
  import it. The application has a single provider.

## ADR-021: A Change of AI Processor Requires a Policy Version Bump

Date: 2026-08-30

Context:

`privacyPolicy.js` told users 「對話會傳送至 Gemini」 and listed `Google Gemini`
as the sole processor. Switching providers makes that statement false, and it is
the statement users consented to under ADR-017's three-tier consent model.

Decision:

Changing which third party receives user conversations bumps
`PRIVACY_POLICY_VERSION` (`2026-08-22.v1` → `2026-08-30.v2`), not just the
wording. Editing the text alone would substitute a different processor under an
unchanged consent record.

Consequences:

- Every existing consent becomes stale; `requireServiceConsent` returns
  `428 CONSENT_VERSION_OUTDATED` until the user re-consents in the Privacy
  Center. Verified in the browser on 2026-08-30.
- Personalization consent is invalidated too, so interaction logging pauses
  until re-granted. This is the designed behaviour (TEST_PLAN IL-15).
- No service code changed: the version-comparison machinery from ADR-017 was
  built for exactly this case.
