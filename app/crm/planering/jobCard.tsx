import { cn } from '@/lib/shared/cn';
import {
  workOrderStatusLabel,
  workOrderStatusClass,
  workOrderStatusAccent,
  type WorkOrderStatus,
} from '@/app/crm/lib/crmTokens';
import type { JobDisplay } from '@/lib/domains/planning/display';

// Status label + colors for a job, reusing the CRM work-order tokens so the planning board reads
// identically to the rest of the CRM.
export function statusMeta(status: string) {
  const s = status as WorkOrderStatus;
  return {
    label: workOrderStatusLabel[s] ?? status,
    pill: workOrderStatusClass[s] ?? 'border-slate-200 bg-slate-50 text-slate-600',
    rail: workOrderStatusAccent[s] ?? 'bg-slate-300',
  };
}

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const m = statusMeta(status);
  return (
    <span className={cn('whitespace-nowrap rounded-full border px-2 py-px text-[9px] font-bold', m.pill, className)}>
      {m.label}
    </span>
  );
}

// Sack badge — amber "kvar X/Y" form is for a later per-day-reporting slice; for now it's the
// planned sack total computed from the work order's line items.
export function SackBadge({ sacks }: { sacks: number }) {
  if (!(sacks > 0)) return null;
  return (
    <span className="whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-px text-[10px] font-bold tabular-nums text-emerald-700">
      {sacks} säck
    </span>
  );
}

export function MaterialChip({ material }: { material: string | null }) {
  if (!material) return null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#e0e8dc] bg-[#f3f6f1] px-2 py-px text-[10px] font-semibold text-slate-600">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {material}
    </span>
  );
}

// The reference shown on cards (Fortnox number, or internal AO when not synced yet).
export function JobRef({ job, className }: { job: Pick<JobDisplay, 'ref' | 'is_fortnox_ref'>; className?: string }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap text-[12px] font-extrabold tabular-nums tracking-tight',
        job.is_fortnox_ref ? 'text-[#1f4a2e]' : 'font-bold text-slate-400',
        className,
      )}
    >
      {job.ref}
    </span>
  );
}
