# Ekovilla (Blikk integration)

A minimal Next.js (React + TypeScript) app to look up Blikk projects by Order ID, prefill an order form, generate a styled PDF, and optionally post a comment back to the Blikk project.

## What’s included
- Server-side Blikk client with token caching (Basic -> Bearer) and 429 retry
- API routes: project lookup and PDF generation (+ simple submit placeholder)
- Optional: server route to post a comment to a Blikk project when a PDF is saved
- Simple UI: enter Order ID -> fetch project -> prefill form -> save or download PDF

## Prerequisites
1) Create a Blikk API application (admin permissions required): https://app.blikk.com/admin/apiapplication
2) Copy the App Id and App Secret.

## Setup
1) Copy the env template and fill in credentials

```bash
cp .env.example .env.local
# edit .env.local with your BLIKK_APP_ID and BLIKK_APP_SECRET
```

2) Install dependencies and run the dev server

```bash
npm install
npm run dev
```

By default the app runs on http://localhost:3000 (or 3001 if busy).

Required environment variables for internal tasks

- NEXT_PUBLIC_SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- TASKS_DEFAULT_ASSIGNEE_UUID — UUID of the default assignee for clothing orders (e.g., Patrik Valls). You can find this in Supabase auth.users. Set it in .env.local and in your deployment environment.

## Try it
- Open the app, enter an Order ID, and click "Lookup Project"
- Confirm the project data shows up
- Edit the installer, work site address, date, and client name fields
- Click "Download PDF" to get a branded PDF summary
- When saving to archive, the server can also post a comment like "Egenkontroll gjord YYYY-MM-DD" to the Blikk project

## Notes
- Base URL: https://publicapi.blikk.com
- Auth flow per docs: POST /v1/Auth/Token (Basic) -> use accessToken as Bearer
- Rate limit: ~4 requests/sec/token (a single automatic retry is included)
- PDF route uses Node runtime (not Edge) and supports simple branding colors and company name

## API routes
- `GET /api/projects/lookup?id=... | orderId=...` — fetch a Blikk project
- `POST /api/pdf/generate` — generate a styled PDF from the form
- `POST /api/blikk/project/comment` — server-side endpoint to add a comment to a project
- `POST /api/orders/submit` — placeholder, echoes back

Legacy endpoints for contacts/users/project-creation were removed for now to keep the project lean. They can be reintroduced if needed.

## Time reporting (multi-context)

The app supports creating time reports against three mutually exclusive target contexts:

1. Normal project (`projectId`)
2. Internal project (`internalProjectId`)
3. Absence project (`absenceProjectId`)

Exactly one of these IDs must be provided per time report. The UI enforces this via a toggle in the Time Report modal. If a selected project (any type) requires a comment (detected from its `commentRequiredWhenTimeReporting` flag in fetched metadata), the modal will require the description field before enabling submit.

### Endpoints

- `GET /api/blikk/time-reports` — list reports (automatically resolves current user's Blikk ID if `userId` omitted).
- `POST /api/blikk/time-reports` — create a time report (see payload below).
- `GET /api/blikk/internal-projects` — fetch internal projects for selection.
- `GET /api/blikk/absence-projects` — fetch absence projects for selection.
- `PATCH /api/blikk/time-reports/{id}` — update a time report (provides complete payload; derives missing fields from existing record when omitted).
- `DELETE /api/blikk/time-reports/{id}` — delete a time report (idempotent; 404 treated as already removed).

### POST payload shape

```jsonc
{
	"date": "2025-10-11",          // ISO date (yyyy-mm-dd)
	"minutes": 120,                 // or "hours": 2 (derives minutes internally)
	"description": "Install work", // required if project metadata demands comment
	"projectId": 123,               // OR internalProjectId OR absenceProjectId (exactly one)
	"activityId": 456,              // optional
	"timeCodeId": 789,              // optional (may be required if BLIKK_REQUIRE_TIMECODE=1)
	"breakMinutes": 15,             // optional
	"startTime": "08:00",          // optional; pass with endTime for tenants requiring explicit times
	"endTime": "10:00"             // optional
}
```

The server adds a shared `timeArticleId` (default 3400 or overridden via `BLIKK_TIME_ARTICLE_ID`) and normalizes body variants to maximize acceptance across tenant differences.

### Relevant environment variables

- `BLIKK_TIME_REPORTS_CREATE_PATH` — override the create path if tenant exposes a different route.
- `BLIKK_TIME_REPORTS_PATH` — override list path.
- `BLIKK_TIME_ARTICLE_ID` — shared time article ID (default 3400).
- `BLIKK_REQUIRE_TIMECODE` — set to `1` to require `timeCodeId` in POST validation.
- `BLIKK_ENABLE_LEGACY_TIME_REPORTS` — if set to `1` allows legacy non-Core delete path fallback; default is off (canonical only).

### Validation rules (server)

- Rejects if `userId` cannot be resolved from Supabase `profiles.blikk_id`.
- Requires `date` and positive duration (`minutes` or `hours`).
- Ensures exactly one of `projectId | internalProjectId | absenceProjectId` is present.
- PATCH also enforces mutual exclusivity and auto-fills missing context/time fields from the existing report.

### Payload alias rationale

Blikk tenants can differ in accepted field names. To maximize compatibility the server/client includes multiple aliases for certain concepts:

- Time-of-day: `startTime`, `endTime`, `timeFrom`, `timeTo`, `start`, `end`, `clockStart`, `clockEnd` (+ ISO datetime variants `from`, `to`, `startDateTime`, `endDateTime`, `startAt`, `endAt`, `dateFrom`, `dateTo` when date known).
- Hours: `minutes` and derived decimal `hours`, plus `invoiceableHours`, `billableHours`, `invoicableHours` (common spelling variant). If `billable=false` then `invoiceableHours` is set to `0` but raw `hours` still reflect actual duration.
- Time article: `timeArticleId`, `timeArticle: { id }`, and `articleId` for acceptance across versions.
- Description/comment: `description` and `comment` (plus legacy `internalComment` empty string to prevent missing key errors).
- Break: `breakMinutes` and `break`.

Update (PATCH) reuses these aliases to avoid cases where tenants reject changes lacking a specific synonym.
- Enforces time code requirement when `BLIKK_REQUIRE_TIMECODE=1`.

### Comment requirement (client)

If the selected project indicates `commentRequiredWhenTimeReporting`, the modal marks the description field as required and blocks submission until filled. This logic is front-end only; you can add server enforcement later if needed.

### Example response (debug mode)

When calling `POST /api/blikk/time-reports?debug=1`, the response includes the normalized `sentBody` used against Blikk:

```jsonc
{
	"ok": true,
	"report": { /* raw Blikk response */ },
	"usedPath": "/v1/Core/TimeReports",
	"sentBody": { /* normalized body with aliases */ }
}
```

### Adding future server-side enforcement

To enforce comment requirement server-side, inspect incoming `projectId/internalProjectId/absenceProjectId` -> fetch project metadata -> reject if missing description while flag is true. (Currently not implemented to avoid extra latency.)

### Project comments
- By default the app will try to post a comment after a PDF is saved if the current project has an `id`.
- You can customize the endpoint path and request body via env:
	- `BLIKK_COMMENTS_PATH_TEMPLATE` (default: `/v1/Core/Projects/{id}/Comments`)
	- `BLIKK_COMMENTS_BODY_KEY` (default: `text`)
- If your Blikk instance supports @mentions via API, you can add them in the comment text. See the inline code comment in `app/page.tsx` where the comment is constructed.

## Project scripts
- dev: next dev
- build: next build
- start: next start
- type-check: tsc --noEmit

## Körjournal backend (Supabase)

This app stores Körjournal trips in Supabase via the server API at `/api/korjournal/trips`.

Environment variables required (set locally and in Vercel):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- (optional) `SUPABASE_ANON_KEY` if you plan to use client-side auth later

Auth

- A simple email magic link sign-in is available at `/auth/sign-in`.
- The page `/korjournal` is protected by a server layout that requires a session.
- The API uses Supabase Auth cookies; each request is scoped to the current user and RLS ensures users only see/insert their own trips.

Suggested table schema (SQL) for `korjournal_trips`:

```sql
-- Enable pgcrypto if you prefer gen_random_uuid(); in newer projects uuid_generate_v4() also works
create extension if not exists pgcrypto;

create table if not exists public.korjournal_trips (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	user_id text null,
	date date not null,
	start_address text not null,
	end_address text not null,
	start_km int4 not null,
	end_km int4 not null,
	note text null,
	sales_person text null
);

alter table public.korjournal_trips enable row level security;

-- If you later add auth and want users to access their own rows from the client, you can add e.g.:
-- create policy "korjournal read own" on public.korjournal_trips
--   for select using (auth.uid()::text = user_id);
-- create policy "korjournal write own" on public.korjournal_trips
--   for insert with check (auth.uid()::text = user_id);
--   
-- NOTE: The server API here uses the Service Role key and therefore bypasses RLS. Keep the API route server-only.
```

Client behavior:

- On load, it fetches trips from the API and caches them in `localStorage` as fallback.
- Adding a trip posts to the API, then updates the list optimistically.
- Export per-month CSV is available from the Körjournal page.
