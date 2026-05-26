# Wave 6 Pause Status And Time Report Bug

Date: 2026-05-26

## Current pause status

Wave 6 is now paused intentionally.

The dashboard sanitation/polish pass was taken through the remaining high-friction user-facing surfaces, preview-tested, and split into a clean merge branch for `main`. Work is paused here so the next feature can start from a stable checkpoint instead of continuing to expand the Wave 6 scope.

## Completed before pause

Dashboard surfaces completed in this pass:

- `components/dashboard/QuickLinks.tsx`
  - refactored away from the older inline-heavy structure
  - desktop/sidebar quick-link affordance restored
- `components/dashboard/ClientDashboard.tsx`
  - hero shell and surrounding dashboard composition cleaned up
  - installer-first mobile ordering preserved intentionally
- `components/dashboard/DashboardNotes.tsx`
  - workspace/Arbetsyta section cleaned up and visually tightened
- `components/dashboard/DashboardTasks.tsx`
  - brought forward as part of the dashboard sanitation set
- `components/dashboard/DashboardDocumentApprovals.tsx`
  - included in the sanitized dashboard surface set
- `components/dashboard/NewsModal.tsx`
  - included in the sanitized dashboard surface set
- `components/dashboard/DashboardSchedule.tsx`
  - schedule card polish completed
  - schedule navigation/buttons normalized
  - schedule metadata layout improved
  - detail modal substantially cleaned up for mobile
  - comments section made collapsible with count/toggle
  - long comment/url overflow fixed
  - modal bottom spacing and scroll containment improved on mobile
- `components/dashboard/TimeReportModal.tsx`
  - reporting flow reorganized into clearer sections
  - report type tabs (`Projekt`, `Intern`, `Frånvaro`) improved
  - mobile readability and action flow improved

Time reporting follow-up completed after the main dashboard pass:

- `app/tidrapport/page.tsx`
  - sanitized to the same mobile-safe standard as the dashboard
  - long text wrapping fixed so report cards do not stretch the page on mobile
- `lib/blikk.ts`
  - time-report payloads now mirror the entered comment into both `comment` and `internalComment`
  - applies to both create and update flows

Shared/base change completed during the pass:

- `app/globals.css`
  - raw global `button` styling was neutralized so feature-level buttons no longer inherit the old dark button behavior by accident

## Earlier regression found and resolved during Wave 6

During the cleanup pass, a backend regression surfaced in time reporting.

Observed symptom:

- Tidrapportering stopped loading time codes.
- UI showed `Invalid query` when loading `/api/blikk/timecodes`.

Root cause:

- `app/api/blikk/_admin-resource.ts` restricted `pageSize` and `limit` too aggressively.
- `components/dashboard/TimeReportModal.tsx` requests larger batch sizes for time codes and activities.

Fix applied:

- `pageSize.max(50)` -> `pageSize.max(200)`
- `limit.max(50)` -> `limit.max(200)`

## Validation status at pause

- `npm run type-check` passed after the latest dashboard and time-reporting changes.
- The dashboard flow was tested in preview before pausing.
- A clean merge branch was prepared for the dashboard package so the work can move toward `main` without dragging unrelated branch history.

## Reason for pausing now

The current Wave 6 slice has reached a good stopping point:

- the remaining dashboard/mobile polish issues that were actively blocking usage were addressed
- the main time-reporting UX regressions found during the pass were addressed
- the branch state is now clean enough to stop safely

Further Wave 6 work is paused so focus can move to the next feature instead of continuing to grow the refactor scope.

## Recommended resume point later

When Wave 6 resumes, continue from the next unsanitized or still inline-heavy frontend surface outside the now-stabilized dashboard/time-reporting slice.