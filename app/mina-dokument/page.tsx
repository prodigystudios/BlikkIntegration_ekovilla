import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { redirect } from 'next/navigation';
import MyDocumentsClient from './MyDocumentsClient';

export const dynamic = 'force-dynamic';

export default async function MinaDokumentPage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/auth/sign-in');

  return <MyDocumentsClient />;
}
