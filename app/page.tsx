import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { ClientDashboard } from '../components/dashboard';
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
  return <ClientDashboard />;
}
