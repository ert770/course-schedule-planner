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
