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

/** Telefon ur Kontaktlistan — bara när namnet ger exakt ETT nummer. */
export function lookupDirectoryPhone(directory: readonly KmaDirectoryEntry[], name: string): string {
  const wanted = normalizeKmaName(name);
  if (!wanted) return '';
  const matches = directory.filter((entry) => normalizeKmaName(entry.name) === wanted && entry.phone?.trim());
  const distinct = new Set(matches.map((entry) => normalizePhone(entry.phone as string)));
  return distinct.size === 1 ? (matches[0].phone as string).trim() : '';
}
