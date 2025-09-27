import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { ClientDashboard } from '../components/dashboard';
import { redirect } from 'next/navigation';
import { getUserProfile } from '../lib/getUserProfile';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    redirect('/auth/sign-in');
  }
  // Fetch profile again (lightweight) to pass role into dashboard until a client context hook is used there.
  const profile = await getUserProfile();
  return <ClientDashboard role={profile?.role || null} />;
}
