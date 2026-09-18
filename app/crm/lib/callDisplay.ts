// Vokabulären för ett samtals utfall — etikett, färg och den lilla förklaringen under valet.
//
// Egen modul för att den nu läses på TVÅ ställen: samtalssidan (/crm/samtal) och samtalskortet i
// offertmodalen. Två kopior hade drivit isär vid första etikettändringen, och just de här orden är
// det säljaren rapporterar på — "Följ upp" måste betyda samma sak i båda vyerna.
//
// Samma mönster som quoteDisplay.ts: ren modul, inga beroenden, importeras av båda ytorna.

export type CrmCallOutcome = 'no_answer' | 'follow_up' | 'positive' | 'negative';

export const CALL_OUTCOME_META: Record<CrmCallOutcome, { label: string; className: string; helper: string }> = {
  no_answer: {
    label: 'Ej svar',
    className: 'border-slate-200 bg-slate-100 text-slate-700',
    helper: 'Ingen kontakt, försök igen senare.',
  },
  follow_up: {
    label: 'Följ upp',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    helper: 'Kontakt fanns, men behöver nytt steg.',
  },
  positive: {
    label: 'Positivt',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    helper: 'Bra signal eller tydligt nästa steg.',
  },
  negative: {
    label: 'Negativt',
    className: 'border-rose-200 bg-rose-50 text-rose-700',
    helper: 'Inte rätt timing eller tydligt nej.',
  },
};

/** Solid markering per utfall — används som vänsterkant på en rad för att kunna skumma listan. */
export const CALL_OUTCOME_ACCENT: Record<CrmCallOutcome, string> = {
  no_answer: 'bg-slate-300',
  follow_up: 'bg-amber-400',
  positive: 'bg-emerald-500',
  negative: 'bg-rose-400',
};

/** Ordningen valen visas i: från "ingen kontakt" till "tydligt nej". */
export const CALL_OUTCOMES: CrmCallOutcome[] = ['no_answer', 'follow_up', 'positive', 'negative'];

/**
 * Tidpunkten från <input type="datetime-local"> till det servern tar emot.
 *
 * Fältet ger lokal tid UTAN zon ("2026-09-18T14:30"), och JS tolkar just den formen i
 * WEBBLÄSARENS zon — vilket är rätt här: användaren skriver klockslaget hen ringde.
 * `toISOString` gör om det till samma ÖGONBLICK i UTC, vilket är vad timestamptz lagrar.
 *
 * ⚠️ Inte att förväxla med kalenderdatum-fällan: ett ögonblick har ingen dag att tappa. Den regeln
 * (stockholmTodayISO) gäller fält som ÄR en dag, inte en tidpunkt.
 *
 * Tomt fält → null, och då sätter databasen `now()`. Ett oläsbart värde ger också null hellre än
 * ett kastat fel: en trasig tidpunkt får inte hindra att samtalet loggas alls.
 */
export function callAtToIso(localValue: string): string | null {
  const trimmed = localValue.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
