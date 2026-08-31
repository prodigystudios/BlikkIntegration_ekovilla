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

  // Lönebyrån har ingen startsida — hennes app är EN yta.
  //
  // Dashboarden är byggd för anställda: personliga anteckningar och möten ("Arbetsyta"),
  // pushnotiser, dokumentattester, uppgifter, planeringsschema. Inget av det betyder något för en
  // extern part som ska kontrollera timmar, och den enda länk som faktiskt ledde till hennes jobb
  // låg i snabblänkarna — som är `lg:hidden`, alltså osynliga på en dator.
  //
  // Att skicka henne rakt in är inte bara städning: det stänger felklassen. En ny widget på
  // dashboarden hade annars dykt upp för henne igen, precis som schemat och "Rapportera tid"
  // gjorde. Villkoren i ClientDashboard ligger kvar som andra försvarslinje om raden här tas bort.
  if (profile?.role === 'ekonomi') redirect('/ekonomi');

  return <ClientDashboard role={profile?.role || null} />;
}
