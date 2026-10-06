// Statusfiltret i offert- och orderlistan: en meny med kryssrutor i stället för flikarna (William,
// 2026-10-06). Här bor valen, vilka statusar varje val täcker, startvalet, frågeparametern och
// knappens text. Ren modul utan beroenden — klienterna, API-rutterna och domänen delar den, och
// reglerna går att pröva utan JSX.
//
// Startvalet visar "allt utom det avslutade": på ordrarna allt utom Avslutad och Avbruten, på
// offerterna allt utom Förlorad (en vunnen offert syns, Williams val). Valet sparas inte — varje
// besök börjar om här, som ansvarigfiltret.

// Bara typer — de raderas vid kompileringen, så modulen drar inte in domänfilerna i klientbundlen.
import type { CrmQuoteStatus } from './quotes';
import type { CrmWorkOrderStatus } from './work-orders';

export const QUOTE_STATUS_FILTER_OPTIONS = ['draft', 'sent', 'follow_up', 'won', 'lost'] as const;
export type QuoteStatusFilterOption = (typeof QUOTE_STATUS_FILTER_OPTIONS)[number];

export const DEFAULT_QUOTE_STATUS_FILTER: readonly QuoteStatusFilterOption[] = ['draft', 'sent', 'follow_up', 'won'];

export const WORK_ORDER_STATUS_FILTER_OPTIONS = [
  'draft', 'scheduled', 'in_progress', 'completed', 'partially_invoiced', 'invoiced', 'cancelled',
] as const;
export type WorkOrderStatusFilterOption = (typeof WORK_ORDER_STATUS_FILTER_OPTIONS)[number];

/**
 * Varje val → statusarna det täcker. Ett val per status som listan visar, utom att Planerad också
 * bär den pensionerade `ready`, som visas som Planerad (crmTokens) och annars hade fallit bort ur
 * varje urval utom "alla".
 */
export const WORK_ORDER_STATUS_FILTER_STATUSES: Record<WorkOrderStatusFilterOption, readonly CrmWorkOrderStatus[]> = {
  draft: ['draft'],
  scheduled: ['scheduled', 'ready'],
  in_progress: ['in_progress'],
  completed: ['completed'],
  partially_invoiced: ['partially_invoiced'],
  invoiced: ['invoiced'],
  cancelled: ['cancelled'],
};

export const DEFAULT_WORK_ORDER_STATUS_FILTER: readonly WorkOrderStatusFilterOption[] = [
  'draft', 'scheduled', 'in_progress', 'completed', 'partially_invoiced',
];

// 🧨 Kompileringsvakter: valen ovan är skrivna för hand, och en ny status i CrmQuoteStatus eller
// CrmWorkOrderStatus hade annars aldrig dykt upp i menyn — dold av varje startval, 400 som
// parameter, aldrig räknad. Glider listorna isär slutar de här två raderna kompilera.
type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const QUOTE_STATUS_FILTER_COVERS_STATUSES: SameMembers<QuoteStatusFilterOption, CrmQuoteStatus> = true;
// Orderns val är statusarna utom den pensionerade `ready`, som Planerad bär.
export const WORK_ORDER_STATUS_FILTER_COVERS_STATUSES: SameMembers<WorkOrderStatusFilterOption | 'ready', CrmWorkOrderStatus> = true;

/**
 * Frågeparametern `statuses`: valen i menyns ordning, kommaseparerade.
 *
 * `null` när ALLT är valt — då skickas ingen parameter och servern filtrerar inte på status alls,
 * så "Alla statusar" betyder alla rader även den dag en ny status tillkommer. En tom sträng betyder
 * att inget är valt, och ger inga rader.
 */
export function statusFilterParam<T extends string>(selected: readonly T[], options: readonly T[]): string | null {
  const chosen = options.filter((option) => selected.includes(option));
  return chosen.length === options.length ? null : chosen.join(',');
}

/**
 * Läser parametern på servern. `undefined` = ingen parameter (inget statusfilter), `[]` = inget valt.
 * Okända värden ger `null`, så att rutten kan svara 400 i stället för att tyst tappa ett val.
 */
export function parseStatusFilterParam<T extends string>(raw: string | undefined, options: readonly T[]): T[] | undefined | null {
  if (raw === undefined) return undefined;
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.some((part) => !(options as readonly string[]).includes(part))) return null;
  return options.filter((option) => parts.includes(option));
}

/** Orderns val → statusarna frågan ska matcha. */
export function workOrderStatusesFor(selected: readonly WorkOrderStatusFilterOption[]): CrmWorkOrderStatus[] {
  return selected.flatMap((option) => WORK_ORDER_STATUS_FILTER_STATUSES[option]);
}

/**
 * Filterknappens text. Ett startval läses som det det är — "Utom Förlorad", "Utom Avslutad,
 * Avbruten" — i stället för ett antal man måste öppna menyn för att tolka.
 */
export function summarizeStatusFilter<T extends string>(
  selected: readonly T[],
  options: readonly T[],
  labelOf: (option: T) => string,
): string {
  const chosen = options.filter((option) => selected.includes(option));
  if (chosen.length === options.length) return 'Alla statusar';
  if (chosen.length === 0) return 'Ingen status';
  if (chosen.length === 1) return labelOf(chosen[0]);
  const excluded = options.filter((option) => !selected.includes(option));
  if (excluded.length <= 2) return `Utom ${excluded.map(labelOf).join(', ')}`;
  return `${chosen.length} statusar`;
}

/** Är valet något annat än startvalet? Räknas som ett aktivt filter på mobilens filterknapp. */
export function isStatusFilterChanged<T extends string>(selected: readonly T[], defaults: readonly T[]): boolean {
  return selected.length !== defaults.length || defaults.some((option) => !selected.includes(option));
}
