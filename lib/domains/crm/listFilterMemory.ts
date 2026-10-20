// CRM-listornas filter över ett sidbyte: sökning, statusval, sortering och ansvarig sitter kvar när man
// öppnar en rad och går tillbaka (William, 2026-10-20). Förut nollades de vid varje montering och fick
// ställas in igen för varje order man tittade på.
//
// Valet bor i fliken (sessionStorage, Williams val) — inte för alltid som planeringens filter. Ett nytt
// besök i en ny flik börjar alltså på startvalet som förut; det är rundresan in i en rad och tillbaka
// som ska minnas. Sökningen följer med med flit: texten syns alltid i rutan, så den döljer inget.
//
// Ren modul: vad som sparas och hur ett sparat värde läses tillbaka. Lagringen och ordningen mot
// listans hämtning bor i app/crm/components/useListFilterMemory.ts. Generisk: order- och
// offertlistan har samma fyra filter med olika statusar och sorteringar.

import { isStatusFilterChanged } from './listStatusFilter';
import { MINE, type AssigneeFilterValue } from './assigneeFilter';

export type ListFilters<Status extends string, Sort extends string> = {
  search: string;
  statuses: Status[];
  sort: Sort;
  assignee: AssigneeFilterValue;
};

export type ListFilterRules<Status extends string, Sort extends string> = {
  statusOptions: readonly Status[];
  sortOptions: readonly Sort[];
  /** Listans startval — det som gäller för varje fält som inte är sparat eller inte går att läsa. */
  defaults: ListFilters<Status, Sort>;
  /**
   * Får "Mina" stå i ansvarigfiltret? False där menyn inte visar valet (lönebyrån) — ett sparat
   * "Mina" hade där gett noll rader bakom en meny som inte kan bocka ur det.
   */
  allowMine: boolean;
};

// Ett användar-id. Rutten prövar inte formen — ett annat värde i `?assignee=` når Postgres som ett
// ogiltigt uuid och ger 500, inte noll rader — så ett sparat värde måste prövas här.
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry) => b.includes(entry));
}

/**
 * Det som ska sparas, som JSON. Bara fälten som avviker från startvalet följer med — varje fält står
 * och faller för sig, så ett fält som står på startvalet räknas om nästa gång i stället för att låsas
 * fast. Ansvarigs startval beror på vem som är inloggad, och statusens kan ändras i koden.
 *
 * `null` när allt står på startvalet: då ska nyckeln tas bort, inte skrivas som `{}`.
 */
export function serializeListFilters<Status extends string, Sort extends string>(
  current: ListFilters<Status, Sort>,
  defaults: ListFilters<Status, Sort>,
): string | null {
  const changed: Partial<ListFilters<Status, Sort>> = {};
  if (current.search !== defaults.search) changed.search = current.search;
  if (isStatusFilterChanged(current.statuses, defaults.statuses)) changed.statuses = current.statuses;
  if (current.sort !== defaults.sort) changed.sort = current.sort;
  if (!sameMembers(current.assignee, defaults.assignee)) changed.assignee = current.assignee;
  return Object.keys(changed).length > 0 ? JSON.stringify(changed) : null;
}

/**
 * Läs tillbaka ett sparat värde. Allt som inte går att läsa ger startvalet för just det fältet: ett
 * trasigt eller gammalt värde ska aldrig ge en lista som filtrerar på något menyn inte kan visa.
 *
 * 🧨 Ett statusval med en OKÄND status förkastas helt, i stället för att den okända gallras bort.
 * Bestod valet bara av en status som sedan döpts om hade gallringen lämnat ett tomt val — "Ingen
 * status", en lista utan rader — där användaren aldrig valt bort något. Ett TOMT sparat val är
 * däremot giltigt: det är användaren som bockat ur allt, och listans tomläge erbjuder vägen tillbaka.
 */
export function restoreListFilters<Status extends string, Sort extends string>(
  raw: string | null,
  rules: ListFilterRules<Status, Sort>,
): ListFilters<Status, Sort> {
  const { defaults } = rules;
  const fresh: ListFilters<Status, Sort> = {
    search: defaults.search,
    statuses: [...defaults.statuses],
    sort: defaults.sort,
    assignee: [...defaults.assignee],
  };
  if (!raw) return fresh;

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (typeof stored !== 'object' || stored === null) return fresh;
  const value = stored as Record<string, unknown>;

  if (typeof value.search === 'string') fresh.search = value.search;

  const statuses = value.statuses;
  if (Array.isArray(statuses) && statuses.every((entry) => (rules.statusOptions as readonly unknown[]).includes(entry))) {
    // Menyns ordning, som statusFilterParam — inte den ordning valet råkade sparas i.
    fresh.statuses = rules.statusOptions.filter((option) => statuses.includes(option));
  }

  if ((rules.sortOptions as readonly unknown[]).includes(value.sort)) fresh.sort = value.sort as Sort;

  // 🧨 Bara "Mina" och användar-id:n. Något annat hade gett ett 500 från rutten vid varje återkomst
  // i fliken, och felrutan döljer tomlägets "Visa alla ansvariga" — vägen ut hade bara varit Rensa.
  const assignee = value.assignee;
  if (Array.isArray(assignee) && assignee.every((entry) => entry === MINE || (typeof entry === 'string' && USER_ID_RE.test(entry)))) {
    // En säljare som slutat matchar inga rader, men hen syns i knappen ("1 vald") och tomläget
    // erbjuder "Visa alla ansvariga" — inte en tyst gallring. "Mina" däremot syns inte där menyn
    // saknar valet, så det får inte följa med dit.
    const unique = [...new Set(assignee as string[])];
    fresh.assignee = rules.allowMine ? unique : unique.filter((entry) => entry !== MINE);
  }

  return fresh;
}
