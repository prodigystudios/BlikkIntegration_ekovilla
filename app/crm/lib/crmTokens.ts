/**
 * Shared design tokens for all CRM pages.
 *
 * Usage:
 *   import { crm, customerStageLabel, customerStageClass, syncStatusLabel, syncStatusClass } from '@/app/crm/lib/crmTokens';
 *   <h1 className={crm.pageTitle}>...</h1>
 *   <span className={cn(crm.badge, customerStageClass[item.customer_stage])}>...</span>
 */

// ── Customer Stage ──────────────────────────────────────────────────────────

export type CustomerStage = 'prospect' | 'customer' | 'fortnox_customer';

export const customerStageLabel: Record<CustomerStage, string> = {
  prospect: 'Prospekt',
  customer: 'Kund',
  fortnox_customer: 'Fortnox-kund',
};

export const customerStageClass: Record<CustomerStage, string> = {
  prospect: 'border-sky-200 bg-sky-50 text-sky-700',
  customer: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  fortnox_customer: 'border-violet-200 bg-violet-50 text-violet-700',
};

// ── Sync Status ─────────────────────────────────────────────────────────────

export type SyncStatus = 'not_synced' | 'pending' | 'synced' | 'failed';

export const syncStatusLabel: Record<SyncStatus, string> = {
  not_synced: 'Ej synkad',
  pending: 'Väntar',
  synced: 'Synkad',
  failed: 'Misslyckad',
};

export const syncStatusClass: Record<SyncStatus, string> = {
  not_synced: 'border-slate-200 bg-slate-50 text-slate-500',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  synced: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
};

// ── Opportunity Status ──────────────────────────────────────────────────────

export type OpportunityStatus = 'qualified' | 'quoted' | 'won' | 'lost';

export const opportunityStatusLabel: Record<OpportunityStatus, string> = {
  qualified: 'Kvalificerad',
  quoted: 'Offert skickad',
  won: 'Vunnen',
  lost: 'Förlorad',
};

export const opportunityStatusClass: Record<OpportunityStatus, string> = {
  qualified: 'border-violet-200 bg-violet-50 text-violet-700',
  quoted: 'border-amber-200 bg-amber-50 text-amber-700',
  won: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  lost: 'border-rose-200 bg-rose-50 text-rose-700',
};

// ── Work Order Status ─────────────────────────────────────────────────────────
// DB enum values are internal keys; these are display-only labels (intentionally
// differ, e.g. completed = "Fakturera"). `ready` is retired (migrated to scheduled);
// `invoiced` = "Avslutad" is the terminal state set after invoicing.

export type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled';

export const workOrderStatusLabel: Record<WorkOrderStatus, string> = {
  draft: 'Ej planerad',
  scheduled: 'Planerad',
  ready: 'Planerad', // retired status — shown as Planerad for any legacy rows
  in_progress: 'Pågående',
  completed: 'Fakturera',
  invoiced: 'Avslutad',
  cancelled: 'Avbruten',
};

export const workOrderStatusClass: Record<WorkOrderStatus, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-600',
  scheduled: 'border-sky-200 bg-sky-50 text-sky-700',
  ready: 'border-sky-200 bg-sky-50 text-sky-700',
  in_progress: 'border-violet-200 bg-violet-50 text-violet-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  invoiced: 'border-teal-200 bg-teal-50 text-teal-700',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
};

// The forward flow shown as a stepper (ready retired; cancelled is off-flow).
export const WORK_ORDER_STATUS_FLOW: WorkOrderStatus[] = ['draft', 'scheduled', 'in_progress', 'completed', 'invoiced'];

// Statuses offered in the editable status picker (flow + cancelled, no retired 'ready').
export const WORK_ORDER_STATUS_OPTIONS: WorkOrderStatus[] = ['draft', 'scheduled', 'in_progress', 'completed', 'invoiced', 'cancelled'];

// ── Design Tokens ───────────────────────────────────────────────────────────

export const crm = {
  // Typography
  pageTitle: 'text-2xl font-bold tracking-tight text-slate-900',
  pageSubtitle: 'text-sm text-slate-500',
  sectionTitle: 'text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400',
  label: 'mb-1.5 text-xs font-semibold text-slate-500',
  fieldValue: 'text-sm text-slate-900',
  emptyValue: 'text-sm italic text-slate-400',

  // Cards
  // Use `card` for list-cards (no padding — content controls its own padding).
  // Use `cardInner` for detail/form cards that have their own internal padding.
  card: 'rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]',
  cardInner: 'rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]',

  // Badge base — combine with a stage/status color class:
  //   cn(crm.badge, customerStageClass[item.customer_stage])
  badge: 'whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',

  // Primary CRM action button (+ Ny kund, + Ny offert, etc.)
  // Pair with: style={{ backgroundColor: 'var(--crm-primary)' }}
  primaryButton:
    'inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-[0.96] active:scale-[0.98]',

  // Save / confirm button used inside forms and sidebars
  saveButton:
    'inline-flex h-11 w-full items-center justify-center rounded-xl border border-emerald-600 bg-gradient-to-b from-emerald-500 to-emerald-600 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.28)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60',

  // Destructive / secondary button (cancel, delete)
  ghostButton:
    'inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50',
} as const;
