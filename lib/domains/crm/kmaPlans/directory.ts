// Kontaktlistan i KMA-planen — telefonnummer ur public.contacts, bara vid exakt och entydig träff.
//
// Ren modul utan importer: både förifyllnaden på servern och dialogen i webbläsaren slår upp här,
// och dialogen får inte dra in förifyllnadens serverberoenden (planeringens och efterkalkylens
// moduler) i sin bundle.
//
// ⚠️ TELEFON BARA VID EXAKT, ENTYDIG NAMNTRÄFF. Ett felaktigt nummer i ett dokument som går till
// beställaren är värre än ett tomt fält — medvetet strängare än notify-customer-routens mer
// förlåtande matchning. Stavas namnet olika, eller finns två personer med samma namn och olika
// nummer, blir svaret tomt.

/** En post i Kontaktlistan (public.contacts). */
export type KmaDirectoryEntry = {
  name: string;
  phone: string | null;
  role: string | null;
};

export const normalizeKmaName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv');

const normalizePhone = (phone: string) => phone.replace(/[^\d+]/g, '');

/**
 * Kontaktlistan utan dubbletter, i namnordning. Samma namn med samma nummer är samma person — listan
 * bär sådana rader (en person under två kategorier), och i förslagslistan hade hen stått två gånger.
 * Rollen tas från den rad som har en. Samma namn med OLIKA nummer är två personer och står kvar båda.
 */
export function dedupeDirectory(entries: readonly KmaDirectoryEntry[]): KmaDirectoryEntry[] {
  const byKey = new Map<string, KmaDirectoryEntry>();
  for (const entry of entries) {
    const name = entry.name?.trim();
    if (!name) continue;
    const role = entry.role?.trim() || null;
    const key = `${normalizeKmaName(name)}|${normalizePhone(entry.phone ?? '')}`;
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, { name, phone: entry.phone?.trim() || null, role });
    else if (!existing.role && role) byKey.set(key, { ...existing, role });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

/**
 * Förslagen för det som skrivits: först de vars namn BÖRJAR med texten, sedan de där ett senare ord
 * gör det ("ber" → Anna Berg), sist de som bara innehåller den. Tom text ger hela listan. Ordningen
 * inom varje grupp behålls (sorteringen är stabil), så listan förblir alfabetisk där.
 */
export function matchDirectory(entries: readonly KmaDirectoryEntry[], query: string): KmaDirectoryEntry[] {
  const q = normalizeKmaName(query);
  if (!q) return [...entries];
  return entries
    .map((entry) => {
      const name = normalizeKmaName(entry.name);
      const rank = name.startsWith(q) ? 0 : name.split(' ').some((word) => word.startsWith(q)) ? 1 : name.includes(q) ? 2 : -1;
      return { entry, rank };
    })
    .filter((candidate) => candidate.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((candidate) => candidate.entry);
}

/** Telefon ur Kontaktlistan — bara när namnet ger exakt ETT nummer. */
export function lookupDirectoryPhone(directory: readonly KmaDirectoryEntry[], name: string): string {
  const wanted = normalizeKmaName(name);
  if (!wanted) return '';
  const matches = directory.filter((entry) => normalizeKmaName(entry.name) === wanted && entry.phone?.trim());
  const distinct = new Set(matches.map((entry) => normalizePhone(entry.phone as string)));
  return distinct.size === 1 ? (matches[0].phone as string).trim() : '';
}
