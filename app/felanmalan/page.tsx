import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { redirect } from 'next/navigation';
import FelanmalanClient from './FelanmalanClient';

export const dynamic = 'force-dynamic';

// Thin server wrapper: middleware already auth-gates this route, but we resolve the session to
// determine whether the user is an arbetsledare (recipient) so the "Inkorg" tab is only shown to
// them. Data loading happens in the client via /api/felanmalan/*.
export default async function FelanmalanPage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const { data: recipient } = await supabase
    .from('fault_report_recipients')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();

  return (
    <Suspense fallback={null}>
      <FelanmalanClient isRecipient={!!recipient} />
    </Suspense>
  );
}
