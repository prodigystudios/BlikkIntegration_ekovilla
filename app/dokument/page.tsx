export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { redirect } from 'next/navigation';
import { getUserProfile } from '../../lib/getUserProfile';
import DocumentsClient from './DocumentsClient';
import PageShell from '../../components/ui/PageShell';

export default async function DokumentPage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/auth/sign-in');

  const profile = await getUserProfile();
  const canEdit = profile?.role === 'admin';

  return (
    <PageShell>
      <DocumentsClient canEdit={canEdit} />
    </PageShell>
  );
}
