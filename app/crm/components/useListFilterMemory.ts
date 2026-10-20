"use client";

import { useEffect, useRef, useState } from 'react';
import type { AssigneeFilterValue } from '@/lib/domains/crm/assigneeFilter';
import { restoreListFilters, serializeListFilters, type ListFilterRules } from '@/lib/domains/crm/listFilterMemory';

// Sök, status, sortering och ansvarig för en CRM-lista, ihågkomna i fliken (sessionStorage) så att de
// överlever ett sidbyte — in på en rad och tillbaka (William, 2026-10-20). Reglerna för vad som sparas
// och hur ett sparat värde läses tillbaka bor i lib/domains/crm/listFilterMemory.ts; här bor bara
// lagringen och ordningen mellan läsning, skrivning och listans första hämtning.
//
// Delas av order- och offertlistan.

// ⚠️ sessionStorage KASTAR i privat läge och med blockerade kakor, den är inte bara tom. Ett blockerat
// lager ska betyda att startvalet står, aldrig att listan inte renderar.
function readFilterMemory(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeFilterMemory(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* ignorera — filtren gäller sidan ut, de överlever bara inte ett sidbyte */
  }
}

/**
 * `storageKey` ska bära ytan och den inloggade (`crm-list-filters:<sökväg>:<användar-id>`): två ytor
 * kan dela en lista med olika startval, och den som loggar in i samma flik ska inte ärva förra
 * användarens urval.
 *
 * `restored` är false tills det sparade valet är inläst — listan ska INTE hämta förrän dess. Utan
 * spärren hade den hämtats två gånger vid varje återkomst, en gång på startvalet och sedan på det
 * sparade; "Laddar…" står ändå där tills första svaret kommit, så väntan på en rendering syns inte.
 */
export function useListFilterMemory<Status extends string, Sort extends string>(
  storageKey: string,
  rules: ListFilterRules<Status, Sort>,
) {
  const [search, setSearch] = useState(rules.defaults.search);
  const [statuses, setStatuses] = useState<Status[]>(() => [...rules.defaults.statuses]);
  const [sort, setSort] = useState<Sort>(rules.defaults.sort);
  const [assignee, setAssignee] = useState<AssigneeFilterValue>(() => [...rules.defaults.assignee]);

  // 🧨 Reglerna läses ur en ref, inte som beroende. Läsningen får bara köras när NYCKELN byts: körs
  // den om för att anroparen gav ett nytt regelobjekt hade den läst lagret före den senaste ändringen
  // och skrivit tillbaka det gamla valet över det användaren just klickade.
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  // Bär NYCKELN, inte bara ja/nej: byts nyckeln medan listan står (en annan inloggad efter en
  // uppdatering) är filtren i state fortfarande den förra nyckelns, och de får varken skrivas under
  // den nya eller hämtas förrän den nya är inläst.
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const restored = restoredKey === storageKey;

  // Läses i en effekt, aldrig i en state-initierare: sidan server-renderas, och sessionStorage finns
  // inte där — servern och klienten hade ritat olika filter, en hydreringskrock.
  useEffect(() => {
    const next = restoreListFilters(readFilterMemory(storageKey), rulesRef.current);
    setSearch(next.search);
    setStatuses(next.statuses);
    setSort(next.sort);
    setAssignee(next.assignee);
    setRestoredKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    // Inte före inläsningen. Läsningen ovan hinner före i samma commit, men utan spärren hade
    // startvalet ändå raderat det sparade valet fram till nästa rendering — och den här effekten
    // hade börjat bero på att läsningen råkar stå först i filen.
    if (!restored) return;
    writeFilterMemory(storageKey, serializeListFilters({ search, statuses, sort, assignee }, rulesRef.current.defaults));
  }, [restored, storageKey, search, statuses, sort, assignee]);

  return { search, setSearch, statuses, setStatuses, sort, setSort, assignee, setAssignee, restored };
}
