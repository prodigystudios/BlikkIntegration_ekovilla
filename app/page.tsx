import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';
// Temporary inline sign-in placeholder (original RootSignIn component missing)
function RootSignIn() {
  return (
    <main style={{ padding: 40, maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Logga in</h1>
      <p style={{ margin: 0, color: '#374151' }}>Du måste vara inloggad för att se innehållet.</p>
      <form action="/api/auth/signin" method="post" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input name="email" type="email" placeholder="E-post" required style={{ padding: 10, border: '1px solid #d1d5db', borderRadius: 8 }} />
        <button type="submit" style={{ padding: '12px 18px', background: '#111827', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Skicka magisk länk</button>
      </form>
    </main>
  );
}

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return <RootSignIn />;
  return <Dashboard />;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 16, padding: 24, display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
      {children}
    </section>
  );
}

function Dashboard() {
  return (
    <main style={{ padding: 32, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 30, letterSpacing: -0.5 }}>Översikt</h1>
      </header>
      <Card title="Snabb länkar">
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li><Link href="/egenkontroll">Egenkontroll</Link></li>
          <li><Link href="/korjournal">Körjournal</Link></li>
          <li><Link href="/plannering">Planering</Link></li>
        </ul>
      </Card>
      <Card title="Status">
        <p style={{ margin: 0, color: '#374151' }}>Detta är startsidan. Lägg till widgets såsom dagens projekt, senaste dokument och notifieringar.</p>
      </Card>
    </main>
  );
}
