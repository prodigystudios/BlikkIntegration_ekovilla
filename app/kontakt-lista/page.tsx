export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';

async function getPhoneList() {
  // Build absolute URL so server-side fetch works in RSC
  const h = headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const url = `${proto}://${host}/data/PhoneList.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load phone list');
  return res.json() as Promise<Record<string, Array<{ name: string; phone?: string; location?: string; role?: string }>>>;
}

function Section({ title, people }: { title: string; people: Array<{ name: string; phone?: string; location?: string; role?: string }> }) {
  return (
    <section className="contacts-section">
      <h2 style={{ fontSize: 18, margin: '16px 0 8px 0' }}>{title}</h2>
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
    </section>
  );
}

export default async function ContactsPage() {
  const data = await getPhoneList();
  // Sort section keys alphabetically (Swedish locale)
  const sections = Object.keys(data)
    .sort((a, b) => a.localeCompare(b, 'sv'))
    .map(key => ({ key, label: key }));

  return (
    <main style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1>Kontaktlista</h1>
      <p style={{ color: '#6b7280', marginTop: -6, marginBottom: 16 }}>Snabbsök kontakt och ring direkt.</p>
  {sections.map(({ key, label }) => (
        data[key as keyof typeof data]?.length ? (
          <Section key={key} title={label} people={data[key as keyof typeof data] as any} />
        ) : null
      ))}
    </main>
  );
}
