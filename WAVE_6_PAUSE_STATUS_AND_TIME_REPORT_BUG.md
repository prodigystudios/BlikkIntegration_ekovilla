# Wave 6 Pause Status And Time Report Bug

Date: 2026-05-25

## Current status

Wave 6 frontend sanitation was paused after finishing the remaining modal cleanup in `components/dashboard/DashboardSchedule.tsx`.

Completed in Wave 6 so far:

- `components/dashboard/QuickLinks.tsx` refactored from large inline-style blocks to class-based styling.
- `components/dashboard/ClientDashboard.tsx` hero and quick-links shell refactored.
- `components/dashboard/DashboardSchedule.tsx` completed through:
  - schedule header and navigation
  - day/job cards
  - detail modal shell and summary cards
  - lower modal section for description, comments, reporting UI, and partial reports

Validation before pause:

- `npm run type-check` passed after the last `DashboardSchedule` slice.
- Local file errors for `DashboardSchedule.tsx` were clean.

## Why work paused

During verification after the latest frontend cleanup, a backend regression surfaced in time reporting.

Observed symptom:

- Tidrapportering stopped loading time codes.
- UI showed `Invalid query` when loading `/api/blikk/timecodes`.

## Root cause

The regression came from the shared admin-resource query parser introduced during the API cleanup.

Affected file:

- `app/api/blikk/_admin-resource.ts`

Problem:

- Shared validation restricted `pageSize` and `limit` to `max(50)`.
- `components/dashboard/TimeReportModal.tsx` requests:
  - `/api/blikk/timecodes?page=1&pageSize=200`
  - `/api/blikk/activities?page=1&pageSize=200`
- These requests started failing validation before the route-specific fetch logic ran, producing `Invalid query`.

Why this matters:

- The bug is not limited to timecodes.
- Activities in the same modal were vulnerable to the same regression because they use the same shared parser and the same batch size.

## Fix applied

Updated shared validation in `app/api/blikk/_admin-resource.ts`:

- `pageSize.max(50)` -> `pageSize.max(200)`
- `limit.max(50)` -> `limit.max(200)`

This restores compatibility with the existing frontend requests without adding per-route workarounds.

## Next recommended step after pause

1. Verify `GET /api/blikk/timecodes?page=1&pageSize=200` returns `200` again.
2. Verify `GET /api/blikk/activities?page=1&pageSize=200` returns `200` again.
3. Sanity-check tidrapport-modal in the browser so both tidkoder and aktiviteter populate.
4. Resume Wave 6 with the next dashboard surface after the time reporting regression is confirmed fixed.