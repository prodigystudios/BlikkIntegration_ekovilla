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

// ── Quote (Offert) Status ─────────────────────────────────────────────────────
// Shared by the offer list (QuotesClient) and the sales board (Säljtavlan) so the
// two views label and colour a quote's status identically.

export type QuoteStatus = 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';

export type QuoteStatusMeta = {
  label: string;
  className: string;   // badge border/bg/text
  cardClass: string;   // list-card border/bg
  amountClass: string; // amount chip border/bg/text
  accent: string;      // solid left-rail colour
};

export const quoteStatusMeta: Record<QuoteStatus, QuoteStatusMeta> = {
  draft: {
    label: 'Utkast',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
    cardClass: 'border-slate-200/90 bg-white',
    amountClass: 'border-slate-200 bg-white text-slate-800',
    accent: 'bg-slate-300',
  },
  sent: {
    label: 'Skickad',
    className: 'border-sky-200 bg-sky-50 text-sky-800',
    cardClass: 'border-sky-100 bg-white',
    amountClass: 'border-sky-200 bg-white text-sky-900',
    accent: 'bg-sky-400',
  },
  follow_up: {
    label: 'Följ upp',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
    cardClass: 'border-amber-100 bg-white ring-1 ring-amber-50',
    amountClass: 'border-amber-200 bg-white text-amber-900',
    accent: 'bg-amber-400',
  },
  won: {
    label: 'Vunnen',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    cardClass: 'border-emerald-100 bg-white',
    amountClass: 'border-emerald-200 bg-white text-emerald-900',
    accent: 'bg-emerald-500',
  },
  lost: {
    label: 'Förlorad',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
    cardClass: 'border-rose-100 bg-white',
    amountClass: 'border-rose-200 bg-white text-rose-900',
    accent: 'bg-rose-400',
  },
};

// ── Work Order Status ─────────────────────────────────────────────────────────
// DB enum values are internal keys; these are display-only labels (intentionally
// differ, e.g. completed = "Fakturera"). `ready` is retired (migrated to scheduled);
// `invoiced` = "Avslutad" is the terminal state set after invoicing.

export type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'partially_invoiced' | 'invoiced' | 'cancelled';

export const workOrderStatusLabel: Record<WorkOrderStatus, string> = {
  draft: 'Ej planerad',
  scheduled: 'Planerad',
  ready: 'Planerad', // retired status — shown as Planerad for any legacy rows
  in_progress: 'Pågående',
  completed: 'Fakturera',
  partially_invoiced: 'Delfakturerad',
  invoiced: 'Avslutad',
  cancelled: 'Avbruten',
};

export const workOrderStatusClass: Record<WorkOrderStatus, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-600',
  scheduled: 'border-sky-200 bg-sky-50 text-sky-700',
  ready: 'border-sky-200 bg-sky-50 text-sky-700',
  in_progress: 'border-violet-200 bg-violet-50 text-violet-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  partially_invoiced: 'border-amber-200 bg-amber-50 text-amber-700',
  invoiced: 'border-teal-200 bg-teal-50 text-teal-700',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
};

// Solid accent colour per status — used as a left rail on list rows for quick scanning.
export const workOrderStatusAccent: Record<WorkOrderStatus, string> = {
  draft: 'bg-slate-300',
  scheduled: 'bg-sky-400',
  ready: 'bg-sky-400',
  in_progress: 'bg-violet-400',
  completed: 'bg-emerald-500',
  partially_invoiced: 'bg-amber-400',
  invoiced: 'bg-teal-500',
  cancelled: 'bg-rose-400',
};

// The forward flow shown as a stepper (ready retired; cancelled is off-flow).
export const WORK_ORDER_STATUS_FLOW: WorkOrderStatus[] = ['draft', 'scheduled', 'in_progress', 'completed', 'partially_invoiced', 'invoiced'];

// Statuses offered in the editable status picker. 'partially_invoiced' is system-set by the
// delfakturering flow (not manually selectable), so it's intentionally excluded here.
export const WORK_ORDER_STATUS_OPTIONS: WorkOrderStatus[] = ['draft', 'scheduled', 'in_progress', 'completed', 'invoiced', 'cancelled'];

// ── Design Tokens ───────────────────────────────────────────────────────────

export const crm = {
  // Typography
  pageTitle: 'text-lg font-bold tracking-tight text-slate-900',
  pageSubtitle: 'text-sm text-slate-500',
  sectionTitle: 'text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400',
  label: 'mb-1 text-xs font-semibold text-slate-500',
  fieldValue: 'text-sm text-slate-900',
  emptyValue: 'text-sm italic text-slate-400',

  // Cards
  // Use `card` for list-cards (no padding — content controls its own padding).
  // Use `cardInner` for detail/form cards that have their own internal padding.
  card: 'rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]',
  cardInner: 'rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-3.5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]',

  // Badge base — combine with a stage/status color class:
  //   cn(crm.badge, customerStageClass[item.customer_stage])
  badge: 'whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',

  // Primary CRM action button (+ Ny kund, + Ny offert, etc.)
  // Pair with: style={{ backgroundColor: 'var(--crm-primary)' }}
  primaryButton:
    'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-[0.96] active:scale-[0.98]',

  // Save / confirm button used inside forms and sidebars
  saveButton:
    'inline-flex h-9 w-full items-center justify-center rounded-xl border border-emerald-600 bg-gradient-to-b from-emerald-500 to-emerald-600 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.28)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60',

  // Destructive / secondary button (cancel, delete)
  ghostButton:
    'inline-flex h-8 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50',

  // ── Form fields (shared across modals/forms; sized for h-9 rows) ───────────
  // Text/number/date/email input. In a flex row use it as-is; the global
  // `input { width:100% }` makes it fill — pair with a grid/flex track for sizing.
  input:
    'h-9 w-full rounded-lg border border-[#dce4d8] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15',
  // <select>
  select:
    'h-9 w-full rounded-lg border border-[#dce4d8] bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-emerald-500',
  // <input type="color"> — put it in a fixed grid track (e.g. grid-cols-[2.5rem_1fr])
  // so it fills the track instead of the global input width:100% blowing it up.
  colorInput: 'h-9 w-full cursor-pointer rounded-lg border border-[#dce4d8] bg-white p-1',
  // Solid primary form button (Spara / Lägg till / Registrera). Pair with
  // style={{ backgroundColor: 'var(--crm-primary)' }}.
  formButton:
    'inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-4 text-[13px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50',
  // Destructive outline button (Ta bort) for form rows.
  dangerButton:
    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#e0e8dc] bg-white px-3 text-[13px] font-semibold text-slate-500 transition hover:border-rose-300 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50',
} as const;
