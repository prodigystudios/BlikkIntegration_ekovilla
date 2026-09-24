import type { ActionStatus, ItemStatus, RiskLevel } from '@/lib/domains/safetyRounds/types';

// Skyddsrondens färger. Varje val har en FYLLD form (när den är vald) och en räls — samma idé som
// arbetsorderns statusräls (workOrderStatusAccent i crmTokens): en tunn färgad kant till vänster
// om raden, som går att läsa av i ögonvrån medan man scrollar checklistan.
//
// ⚠️ Kontrasten är mätt för vit text: emerald-700, rose-700, orange-700 och slate-600 klarar AA
// (≥ 4,5:1). Gult gör det inte med vit text, därför bär Delvis mörk text på amber-400.

export const ITEM_STATUS_SELECTED: Record<ItemStatus, string> = {
  ok: 'border-emerald-700 bg-emerald-700 text-white',
  partial: 'border-amber-400 bg-amber-400 text-amber-950',
  defect: 'border-rose-700 bg-rose-700 text-white',
  na: 'border-slate-600 bg-slate-600 text-white',
};

export const ITEM_STATUS_RAIL: Record<ItemStatus, string> = {
  ok: 'bg-emerald-600',
  partial: 'bg-amber-400',
  defect: 'bg-rose-600',
  na: 'bg-slate-400',
};

/** null = "–". */
export const RISK_SELECTED: Record<RiskLevel | 'none', string> = {
  none: 'border-slate-600 bg-slate-600 text-white',
  low: 'border-emerald-700 bg-emerald-700 text-white',
  medium: 'border-amber-400 bg-amber-400 text-amber-950',
  high: 'border-orange-700 bg-orange-700 text-white',
  severe: 'border-rose-800 bg-rose-800 text-white',
};

export const ACTION_STATUS_BADGE: Record<ActionStatus, string> = {
  not_started: 'border-slate-200 bg-slate-50 text-slate-700',
  in_progress: 'border-sky-200 bg-sky-50 text-sky-800',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  delayed: 'border-amber-200 bg-amber-50 text-amber-900',
  written_off: 'border-slate-200 bg-white text-slate-500',
};

export const ROUND_STATUS_BADGE = {
  draft: 'border-amber-200 bg-amber-50 text-amber-900',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
} as const;

export const ROUND_STATUS_LABEL = { draft: 'Utkast', completed: 'Slutförd' } as const;
