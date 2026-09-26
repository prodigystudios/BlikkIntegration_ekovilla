import { createSessionClient } from '@/lib/supabase/session';
import { redirect } from 'next/navigation';
import MyDocumentsClient from './MyDocumentsClient';

export const dynamic = 'force-dynamic';

export default async function MinaDokumentPage() {
  const supabase = createSessionClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/auth/sign-in');

  return <MyDocumentsClient />;
}
