import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function NewsArchivePage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/auth/sign-in');

  const { data, error } = await supabase
    .from('news_items')
    .select('id, headline, body, image_url, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  const items = Array.isArray(data) ? data : [];

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: '0 auto', display: 'grid', gap: 16 }}>
      <header style={{ display: 'grid', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 30, letterSpacing: -0.4 }}>Nyheter</h1>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Arkiv över tidigare publicerade nyheter.</div>
      </header>

      {error && (
        <div style={{ border: '1px solid #fecaca', background: '#fff1f2', color: '#991b1b', borderRadius: 12, padding: 12, fontSize: 13 }}>
          Kunde inte hämta nyheter: {error.message}
        </div>
      )}

      {!error && items.length === 0 && (
        <div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 16, padding: 16, color: '#374151' }}>
          Inga nyheter ännu.
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {items.map((it: any) => {
          const created = it.created_at ? new Date(it.created_at).toLocaleString('sv-SE') : '';
          const img = (it.image_url || '').trim();
          return (
            <article key={it.id} style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
              {img && (
                <div style={{ width: '100%', maxHeight: 260, overflow: 'hidden', background: '#f8fafc' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt="" style={{ width: '100%', height: '100%', maxHeight: 260, objectFit: 'cover', display: 'block' }} />
                </div>
              )}
              <div style={{ padding: 16, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>{it.headline}</div>
                  {created && <div style={{ fontSize: 12, color: '#6b7280' }}>{created}</div>}
                </div>
                <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {it.body}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
