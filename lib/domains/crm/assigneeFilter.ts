// Reglerna bakom "Ansvarig"-filtret i CRM-listorna (offert, arbetsorder, säljtavla).
//
// Egen modul och inte i komponenten: testkörningen transformerar ingen JSX, så logik som bor i en
// .tsx går inte att pröva alls. Komponenten (app/crm/components/AssigneeFilter.tsx) återexporterar
// det här, så anropare kan fortsätta importera från den.

export type AssigneeOption = { id: string; full_name: string | null };
// Multi-select: varje post är ett användar-id eller sentinelen 'mine'. Tom lista = alla.
export type AssigneeFilterValue = string[];

export const MINE = 'mine';

// Startvärdet för en lista: den inloggades egna rader.
//
// 🧨 Reserven är ALLA, inte MINE. Utan ett känt id löser MINE upp till tomt — i säljtavlan (som
// filtrerar i klienten) hade det tömt hela tavlan, och i listorna hade det sett ut som ett register
// utan rader. "Vi vet inte vem du är" ska visa allt, inte inget.
export function defaultAssigneeFilter(currentUserId: string | null): AssigneeFilterValue {
  return currentUserId ? [MINE] : [];
}

// Filtervärdet som det går ut på tråden: `?assignee=` med riktiga id:n, komma-separerade.
//
// 🧨 MINE löses upp HÄR, aldrig i servern. Sentinelen betyder "den som frågar", och en server som
// tolkade den hade fått avgöra vem det är utifrån ett värde klienten skickade.
// Tomt resultat = ingen parameter = alla, vilket är rätt reserv för ett okänt id.
export function assigneeQueryParam(value: AssigneeFilterValue, currentUserId: string | null): string {
  return value
    .map((entry) => (entry === MINE ? (currentUserId ?? '') : entry))
    .filter(Boolean)
    .join(',');
}

// Human-readable summary for the trigger button.
export function summarizeAssigneeFilter(value: AssigneeFilterValue, users: AssigneeOption[]): string {
  if (value.length === 0) return 'Alla ansvariga';
  if (value.length === 1) {
    const only = value[0];
    if (only === MINE) return 'Mina';
    return users.find((u) => u.id === only)?.full_name || '1 vald';
  }
  return `${value.length} valda`;
}

// Does an item with this assigned_to pass the filter? Empty selection = show all.
//
// ⚠️ Bara säljtavlan går den här vägen. Offert- och orderlistan skickar `assigneeQueryParam` till
// servern, där urvalet blir `in('assigned_to', …)` — och den matchar aldrig null, alltså faller
// rader utan ansvarig bort där men inte här.
export function matchesAssignee(
  assignedTo: string | null | undefined,
  value: AssigneeFilterValue,
  currentUserId: string | null,
): boolean {
  if (!value || value.length === 0) return true;
  for (const sel of value) {
    if (sel === MINE) {
      if (currentUserId && assignedTo === currentUserId) return true;
    } else if (assignedTo === sel) {
      return true;
    }
  }
  return false;
}
