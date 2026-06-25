// Pure normalization for the public contacts payload. Handles both the current
// shape ({ contacts: [...], addresses: [...] }) and the legacy grouped shape
// (category keys → arrays, plus an optional "Adresser" key), then groups by
// category and sorts by area/role (tie-break on name). Kept side-effect-free so
// it can be unit-tested in isolation.

export type PublicContact = {
  id: string;
  name: string;
  phone?: string | null;
  location?: string | null;
  role?: string | null;
  category: string;
};

export type PublicAddress = { id: string; name: string; address: string };

export type ContactCategory = { name: string; people: PublicContact[] };

export type NormalizedContacts = { categories: ContactCategory[]; addresses: PublicAddress[] };

function compareByAreaThenName(a: PublicContact, b: PublicContact) {
  const aKey = (a.location || a.role || '').trim();
  const bKey = (b.location || b.role || '').trim();
  if (aKey && bKey) {
    const cmp = aKey.localeCompare(bKey, 'sv', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
  } else if (aKey && !bKey) {
    return -1;
  } else if (!aKey && bKey) {
    return 1;
  }
  return (a.name || '').localeCompare(b.name || '', 'sv', { sensitivity: 'base' });
}

export function normalizeContacts(raw: any): NormalizedContacts {
  const data =
    raw && typeof raw === 'object' && 'data' in raw && raw.data && typeof raw.data === 'object'
      ? (raw.data as Record<string, unknown>)
      : (raw as Record<string, unknown>) || {};

  let contactsArr: PublicContact[] = [];
  let addressesArr: PublicAddress[] = [];

  if (Array.isArray((data as any).contacts)) {
    contactsArr = (data as any).contacts as PublicContact[];
  } else {
    // Legacy grouped shape: keys = category names + optional "Adresser".
    for (const [key, value] of Object.entries(data)) {
      if (key === 'Adresser' && Array.isArray(value)) {
        addressesArr = value.map((a: any) => ({ id: a.id || a.name, name: a.name, address: a.address }));
      } else if (Array.isArray(value)) {
        contactsArr.push(
          ...value.map((p: any) => ({
            id: p.id || p.name,
            name: p.name,
            phone: p.phone,
            location: p.location,
            role: p.role,
            category: key,
          })),
        );
      }
    }
  }

  if (Array.isArray((data as any).addresses)) {
    addressesArr = ((data as any).addresses as any[]).map((a) => ({ id: a.id, name: a.name, address: a.address }));
  }

  const grouped: Record<string, PublicContact[]> = {};
  for (const c of contactsArr) {
    if (!c.category) continue;
    (grouped[c.category] ||= []).push(c);
  }
  Object.values(grouped).forEach((arr) => arr.sort(compareByAreaThenName));

  const categories = Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b, 'sv'))
    .map((name) => ({ name, people: grouped[name] }));

  return { categories, addresses: addressesArr };
}
