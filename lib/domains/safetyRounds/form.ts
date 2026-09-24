import type { SafetyRoundAction, SafetyRoundBundle, SafetyRoundItem } from './types';

// Formulärets rena logik — det som annars hade legat utspritt i komponenterna och inte gått att
// testa. Ingen "use client": protokollet (document.ts) grupperar punkterna med samma funktion som
// formuläret, så ordningen på papperet och i mobilen aldrig kan gå isär.

export type ItemGroup = { code: string; label: string; items: SafetyRoundItem[] };

/**
 * Punkterna per kategori, i den ordning kategorierna först förekommer. Punkterna kopierades in i
 * katalogens ordning när ronden startades, och egna punkter läggs sist i sin kategori — så en
 * stabil gruppering i läsordning är allt som behövs.
 */
export function groupItemsByCategory(items: readonly SafetyRoundItem[]): ItemGroup[] {
  const groups = new Map<string, ItemGroup>();
  for (const item of items) {
    const group = groups.get(item.category_code) ?? { code: item.category_code, label: item.category_label, items: [] };
    group.items.push(item);
    groups.set(item.category_code, group);
  }
  return [...groups.values()];
}

/**
 * Formulärets grupper: rondens egna (i rondens ordning) följda av katalogens kategorier som ännu
 * saknar punkter i ronden — framför allt "I. Egna punkter", som inte har några fasta punkter och
 * annars aldrig hade gått att lägga något i. Protokollet visar bara grupper med punkter.
 */
export function withEmptyCategories(
  groups: readonly ItemGroup[],
  categories: ReadonlyArray<{ code: string; label: string }>,
): ItemGroup[] {
  const present = new Set(groups.map((group) => group.code));
  return [
    ...groups,
    ...categories.filter((c) => !present.has(c.code)).map((c) => ({ code: c.code, label: c.label, items: [] })),
  ];
}

/** Delvis och Brist öppnar punktens detaljer (risk, beskrivning, handlingsplan) — mallens logik. */
export function needsDetails(item: Pick<SafetyRoundItem, 'status'>): boolean {
  return item.status === 'partial' || item.status === 'defect';
}

/** Åtgärderna som hör till en punkt (oftast en). */
export function actionsForItem(actions: readonly SafetyRoundAction[], itemId: string): SafetyRoundAction[] {
  return actions.filter((action) => action.item_id === itemId);
}

/**
 * Förslaget till "Risk / brist" när en punkt förs till handlingsplanen: det rondledaren skrev som
 * beskrivning, annars kontrollpunktens egen fråga. Fältet går att skriva om i handlingsplanen.
 */
export function defaultFindingForItem(item: Pick<SafetyRoundItem, 'description' | 'text'>): string {
  const description = item.description?.trim();
  return (description || item.text.trim()).slice(0, 500);
}

export type StepCounts = {
  participants: number;
  assessed: number;
  total: number;
  actions: number;
};

/** Talen i stegens flikar: "Deltagare 3", "Checklista 12/20", "Handlingsplan 2". */
export function stepCounts(bundle: Pick<SafetyRoundBundle, 'participants' | 'items' | 'actions'>): StepCounts {
  return {
    participants: bundle.participants.length,
    assessed: bundle.items.filter((item) => item.status !== null).length,
    total: bundle.items.length,
    actions: bundle.actions.length,
  };
}
