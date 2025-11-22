export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';

type PublicContact = { id: string; name: string; phone?: string | null; location?: string | null; role?: string | null; category: string };
type PublicAddress = { id: string; name: string; address: string };
interface ContactsPayload { contacts?: any; addresses?: any; Adresser?: any }

async function getContacts(): Promise<ContactsPayload> {
  const h = headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const url = `${proto}://${host}/api/contacts`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load contacts');
  return res.json();
}

function Section({ title, people, defaultOpen = false }: { title: string; people: Array<{ name: string; phone?: string; location?: string; role?: string }>, defaultOpen?: boolean }) {
  // Use <details> for native accessibility and animation
  return (
    <details className="accordion-panel" {...(defaultOpen ? { open: true } : {})}>
  <summary className="accordion-summary">{title}</summary>
      <div className="accordion-content">
        <div className="contacts-grid">
          <div className="contacts-header">
            <div className="contacts-cell">Namn</div>
            <div className="contacts-cell">Telefon</div>
            <div className="contacts-cell">Område/Roll</div>
          </div>
          {people.map((p, i) => (
            <div key={p.name + i} className="contacts-row">
              <div className="contacts-cell contacts-name">{p.name}</div>
              <div className="contacts-cell">
                {p.phone ? (
                  <a href={`tel:${p.phone.replace(/\s+/g, '')}`} style={{ color: '#0ea5e9', textDecoration: 'none' }}>{p.phone}</a>
                ) : (
                  <span className="contacts-muted">–</span>
                )}
              </div>
              <div className="contacts-cell contacts-info">{p.location || p.role || '–'}</div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

export default async function ContactsPage() {
  let data: ContactsPayload;
  try {
    data = await getContacts();
  } catch (e) {
    return (
      <main style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
        <h1>Kontaktlista</h1>
        <p style={{ color: '#dc2626' }}>Kunde inte ladda kontaktlistan.</p>
      </main>
    );
  }

  let contactsArr: PublicContact[] = [];
  let addressesArr: PublicAddress[] = [];

  // New shape
  if (Array.isArray(data.contacts)) {
    contactsArr = data.contacts as PublicContact[];
  } else {
    // Legacy grouped shape: keys = category names + optional Adresser
    for (const [key, value] of Object.entries(data)) {
      if (key === 'Adresser' && Array.isArray(value)) {
        addressesArr = value.map((a: any) => ({ id: a.id || a.name, name: a.name, address: a.address }));
      } else if (Array.isArray(value)) {
        // value = [{ name, phone, location/role }]
        contactsArr.push(...value.map((p: any) => ({
          id: p.id || p.name,
            name: p.name,
            phone: p.phone,
            location: p.location,
            role: p.role,
            category: key
        })));
      }
    }
  }

  if (Array.isArray(data.addresses)) {
    addressesArr = (data.addresses as any[]).map(a => ({ id: a.id, name: a.name, address: a.address }));
  }

  // Group by category
  const grouped: Record<string, PublicContact[]> = {};
  for (const c of contactsArr) {
    if (!c.category) continue;
    if (!grouped[c.category]) grouped[c.category] = [];
    grouped[c.category].push(c);
  }
  // Sort each category by Område/Roll (location/role) alphabetically, tie-break by Name
  Object.values(grouped).forEach(arr => arr.sort((a, b) => {
    const aKey = (a.location || a.role || '').trim();
    const bKey = (b.location || b.role || '').trim();
    if (aKey && bKey) {
      const cmp = aKey.localeCompare(bKey, 'sv', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
    } else if (aKey && !bKey) {
      return -1; // non-empty before empty
    } else if (!aKey && bKey) {
      return 1;
    }
    return (a.name || '').localeCompare(b.name || '', 'sv', { sensitivity: 'base' });
  }));
  const categories = Object.keys(grouped).sort((a,b)=>a.localeCompare(b,'sv'));

  return (
    <main style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1>Kontaktlista</h1>
      <p style={{ color: '#6b7280', marginTop: -6, marginBottom: 16 }}>Snabbsök kontakt och ring direkt.</p>
      {categories.length === 0 && (
        <div style={{ color:'#6b7280', fontStyle:'italic', paddingTop:8 }}>Inga kontakter hittades.</div>
      )}
      {categories.map((cat, idx) => (
        <Section key={cat} title={cat} people={grouped[cat].map(c=>({ name: c.name, phone: c.phone||undefined, location: c.location||undefined, role: c.role||undefined }))} defaultOpen={idx===0} />
      ))}
      {addressesArr.length > 0 && (
        <details className="accordion-panel" style={{ marginTop: 40 }}>
          <summary className="accordion-summary">Depåer</summary>
          <div className="accordion-content">
            <div style={{ display: 'grid', gap: 16 }}>
              {addressesArr.map(addr => {
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr.address)}`;
                return (
                  <div key={addr.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 18px', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{addr.name}</div>
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: 15, marginTop: 2, textDecoration: 'underline', wordBreak: 'break-word' }}>{addr.address}</a>
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      )}
    </main>
  );
}
