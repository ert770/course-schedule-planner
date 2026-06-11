# Architecture

## Overview

```text
React/Vite Frontend
        |
        | HTTP JSON
        v
Express Backend
        |
        +--> Routes
        +--> Services
        +--> Skills
        +--> MySQL Data Adapter
        +--> Local JSON fallback data
        |
        +--> Gemini API
```

## Frontend

Location: `client/`

Key files:

- `client/src/App.jsx`
- `client/src/services/api.js`
- `client/src/pages/*.jsx`
- `client/src/components/*/*.jsx`

The frontend continues to call the same REST endpoints. Course identifiers returned from the backend are section-level ids from `Course_Sections.section_id`.

## Backend

Location: `server/`

Key files:

- `server/src/app.js`
- `server/src/routes/*.js`
- `server/src/services/*.js`
- `server/src/skills/*.js`
- `server/src/db/database.js`
- `server/src/db/mysql.js`

Routes expose API behavior, services hold cross-route logic, and skills implement course query, review query, and scheduling logic.

## Data Layer

Runtime data access is centralized in `server/src/db/database.js`.

MySQL-backed collections:

- `courses`: joined from `Course_Sections` and `Courses`
- `reviews`: read from `Courses_Reviews`
- `user_preferences`: read from `User_Profiles` for numeric user ids

Local JSON-backed collections:

- `users`
- `chat_history`
- `saved_schedules`
- demo or non-numeric `user_preferences`

The MySQL connection pool is configured in `server/src/db/mysql.js` through environment variables:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_SSL_CA_PATH`

## Scheduling Flow

```text
DashboardPage
  -> scheduleAPI.generate()
  -> POST /api/schedule/generate
  -> routes/schedule.js
  -> skills/courseQuery.js or db/database.js
  -> skills/scheduler.js
  -> JSON response
  -> ScheduleGrid
```

The scheduler receives section-level course objects. `watching` courses are only visual/comparison items and do not count as formal conflicts; `selected` courses occupy time slots.

## AI Agent Flow

```text
POST /api/chat
  -> services/agentService.js
  -> services/promptService.js
  -> Gemini
  -> skills/courseQuery.js, reviewSearch.js, scheduler.js
  -> final reply
```

Agent tool calls are asynchronous because course and review data may come from MySQL.
