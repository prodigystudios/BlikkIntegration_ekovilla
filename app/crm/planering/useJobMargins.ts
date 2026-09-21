"use client";

import { useBatchMargins } from '@/lib/useBatchMargins';

// Marginalen per jobb för planeringstavlans kort: TG1 vid insäljning, plus utfallet när det finns.
//
// Hämtningen delas med arbetsorderlistan (useBatchMargins). Rutten är en egen, smal nyttolast —
// kortet ritar ett märke och ska aldrig ha orderns kostnadsuppställning i webbläsaren.

export type JobMargin = {
  /** Planen står på bara en del av orderns intäkt — talen nedan är då redan nollställda av rutten. */
  plan_partial: boolean;
  /** Förkalkylen: planerade säckar × kr/säck, uppskattad tid ur produktivitetstabellen. */
  plan_tg1: number | null;
  plan_tb2: number | null;
  /**
   * Efterkalkylen: rapporterade säckar och rapporterad tid.
   *
   * 🧨 ETT TAL HÄR BETYDER INTE ATT JOBBET ÄR FÄRDIGT. `missingSackReports` i afterCalculation.ts
   * är `effective.length === 0` — EN delrapport räcker för att materialkostnaden ska räknas som
   * komplett, och den prissätter då de säckar som hunnit blåsas mot HELA orderns intäkt.
   * Arbetstiden har ingen fullständighetskontroll alls. På en arbetsorder man öppnar är det en
   * kantfall; på en planeringstavla är pågående flerdagarsjobb själva normalfallet. Ytan gatar
   * därför på egenkontrollen (`sacks_final`), som kortet redan bär.
   */
  actual_tg1: number | null;
  actual_tb2: number | null;
};

/**
 * Hämtar plan- och utfallsmarginal för de jobb tavlan visar.
 *
 * `version` invaliderar cachen: marginalen ändras när en rapport kommer in, och tavlan står uppe
 * hela dagen hos planerarna. Utan den frös märket medan säckbadgen två rader upp uppdaterades live.
 */
export function useJobMargins(workOrderIds: string[], version: string) {
  const { items, forbidden } = useBatchMargins<JobMargin>('/api/crm/work-orders/margins', workOrderIds, version);
  return { margins: items, forbidden };
}
