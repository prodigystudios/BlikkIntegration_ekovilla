export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { redirect } from 'next/navigation';
import { getUserProfile } from '../../lib/getUserProfile';
import DocumentsClient from './DocumentsClient';

export default async function DokumentPage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/auth/sign-in');

  const profile = await getUserProfile();
  const canEdit = profile?.role === 'admin';

  return (
    <main style={{ padding: '16px 20px', width: '100%', boxSizing: 'border-box' }}>
      <h1>Dokument</h1>
      <p style={{ color: '#6b7280', marginTop: -6 }}>
        Ordna dokument i mappar och undermappar.
      </p>
      <DocumentsClient canEdit={canEdit} />
    </main>
  );
}
