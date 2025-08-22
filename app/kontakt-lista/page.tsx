export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { useState } from 'react';

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

function Section({ title, people, defaultOpen = false }: { title: string; people: Array<{ name: string; phone?: string; location?: string; role?: string }>, defaultOpen?: boolean }) {
  // Use <details> for native accessibility and animation
  return (
    <details className="accordion-panel" {...(defaultOpen ? { open: false } : {})}>
      <summary className="accordion-summary">
        {title}
        <span className="accordion-arrow" aria-hidden>▶</span>
      </summary>
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
  const data = await getPhoneList();
  // Separate out addresses and contact sections
  const { Adresser, ...contacts } = data;
  // Only contact sections, sorted
  const contactSections = Object.keys(contacts)
    .sort((a, b) => a.localeCompare(b, 'sv'))
    .map(key => ({ key, label: key }));

  return (
    <main style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1>Kontaktlista</h1>
      <p style={{ color: '#6b7280', marginTop: -6, marginBottom: 16 }}>Snabbsök kontakt och ring direkt.</p>
      {/* Contact sections */}

      {contactSections.map(({ key, label }, idx) => (
        contacts[key as keyof typeof contacts]?.length ? (
          <Section key={key} title={label} people={contacts[key as keyof typeof contacts] as any} defaultOpen={idx === 0} />
        ) : null
      ))}

      {/* Company addresses */}
      {Array.isArray(Adresser) && Adresser.length > 0 && (
        <details className="accordion-panel" style={{ marginTop: 40 }}>
          <summary className="accordion-summary">
            Depåer
            <span className="accordion-arrow" aria-hidden>▶</span>
          </summary>
          <div className="accordion-content">
            <div style={{ display: 'grid', gap: 16 }}>
              {Adresser.map((addr: any, i: number) => {
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr.address)}`;
                return (
                  <div key={addr.name + i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 18px', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{addr.name}</div>
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#2563eb', fontSize: 15, marginTop: 2, textDecoration: 'underline', wordBreak: 'break-word' }}
                    >
                      {addr.address}
                    </a>
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
