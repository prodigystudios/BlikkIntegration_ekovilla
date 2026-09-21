"use client";

import { useBatchMargins } from '@/lib/useBatchMargins';

// Marginalen per jobb för planeringstavlans kort: TG1 vid insäljning, plus utfallet när det finns.
//
// Hämtningen delas med arbetsorderlistan (useBatchMargins). Rutten är en egen, smal nyttolast —
// kortet ritar ett märke och ska aldrig ha orderns kostnadsuppställning i webbläsaren.

export type JobMargin = {
  /** Förkalkylen: planerade säckar × kr/säck, uppskattad tid ur produktivitetstabellen. */
  plan_tg1: number | null;
  plan_tb1: number | null;
  plan_tb2: number | null;
  /**
   * Efterkalkylen: rapporterade säckar och rapporterad tid.
   *
   * ⚠️ `actual_tg1` är icke-null ENBART när hela materialet gick att prissätta — och det är exakt
   * villkoret som gör talet jämförbart med `plan_tg1` (samma intäktsunderlag). Ytan får därför
   * visa paret rakt av när utfallet finns, men aldrig fylla luckan med något annat när det är null.
   */
  actual_tg1: number | null;
  actual_tb1: number | null;
  actual_tb2: number | null;
};

/** Hämtar plan- och utfallsmarginal för de jobb tavlan visar. */
export function useJobMargins(workOrderIds: string[]) {
  const { items, forbidden } = useBatchMargins<JobMargin>('/api/crm/work-orders/margins', workOrderIds);
  return { margins: items, forbidden };
}
