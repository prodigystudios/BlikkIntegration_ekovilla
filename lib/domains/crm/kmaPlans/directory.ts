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

export const normalizeKmaPhone = (phone: string) => phone.replace(/[^\d+]/g, '');

/**
 * Kontaktlistan utan dubbletter, i namnordning. Samma namn med samma nummer är samma person — listan
 * bär sådana rader (en person under två kategorier), och i förslagslistan hade hen stått två gånger.
 * Rollen tas från den rad som har en. Samma namn med OLIKA nummer är två personer och står kvar båda.
 *
 * En rad UTAN nummer bär ingenting som skiljer den från en rad med samma namn och ett nummer — den
 * slås ihop med den (och bidrar med sin roll). Hade den stått kvar var den en andra "Johan Borres"
 * vars val skrev in ett tomt nummer. Finns två olika personer med namnet går den inte att tillskriva
 * någon av dem, och faller bort hellre än att gissa.
 */
export function dedupeDirectory(entries: readonly KmaDirectoryEntry[]): KmaDirectoryEntry[] {
  const withPhone = new Map<string, KmaDirectoryEntry>();
  const phoneless: KmaDirectoryEntry[] = [];
  for (const entry of entries) {
    const name = entry.name?.trim();
    if (!name) continue;
    const role = entry.role?.trim() || null;
    const phone = entry.phone?.trim() || null;
    if (!phone) {
      phoneless.push({ name, phone: null, role });
      continue;
    }
    const key = `${normalizeKmaName(name)}|${normalizeKmaPhone(phone)}`;
    const existing = withPhone.get(key);
    if (!existing) withPhone.set(key, { name, phone, role });
    else if (!existing.role && role) withPhone.set(key, { ...existing, role });
  }

  const withoutPhone = new Map<string, KmaDirectoryEntry>();
  for (const entry of phoneless) {
    const name = normalizeKmaName(entry.name);
    const sameName = [...withPhone.entries()].filter(([key]) => key.startsWith(`${name}|`));
    if (sameName.length === 1) {
      const [key, person] = sameName[0];
      if (!person.role && entry.role) withPhone.set(key, { ...person, role: entry.role });
      continue;
    }
    if (sameName.length > 1) continue;
    const existing = withoutPhone.get(name);
    if (!existing) withoutPhone.set(name, entry);
    else if (!existing.role && entry.role) withoutPhone.set(name, { ...existing, role: entry.role });
  }

  return [...withPhone.values(), ...withoutPhone.values()].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
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
  const distinct = new Set(matches.map((entry) => normalizeKmaPhone(entry.phone as string)));
  return distinct.size === 1 ? (matches[0].phone as string).trim() : '';
}
