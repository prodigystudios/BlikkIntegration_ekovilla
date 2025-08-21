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
