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
