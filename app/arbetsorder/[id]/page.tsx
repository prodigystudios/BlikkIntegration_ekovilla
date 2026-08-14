import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import WorkOrderInstallerClient from '../WorkOrderInstallerClient';

export const dynamic = 'force-dynamic';

// Field view for installers (and anyone). Lives outside /crm (which is office-only) so
// member-role staff can open it via a direct link. Read-only essentials + write on
// time/comments; editing the order stays in /crm/arbetsorder/[id] for CRM roles.
export default async function InstallerWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  // Tid-fliken i fältvyn är ÖPPEN BARA FÖR ATTESTANSVARIGA, tills vidare.
  //
  // Den är byggd och fungerar — endpointen finns, och RLS släpper redan igenom en installatör på
  // sin egen order. Det som håller den stängd är inte teknik utan att besättningen fortfarande
  // rapporterar i Blikk: en flik här hade blivit en andra plats att rapportera på, och timmar som
  // hamnar i CRM i stället för i Blikk når aldrig lönekörningen. Nyckeln är alltså ett testfönster
  // (William 2026-08-14), inte en behörighetsmodell — när cutovern beslutas tas villkoret bort och
  // fliken visas för alla som når ordern.
  //
  // Behörigheten läses här och inte i klienten: sidan är rätt ställe för åtkomstbeslut, och en
  // klient som frågar själv hade blinkat till med fel flikrad medan svaret var på väg.
  //
  // `createServerComponentClient` och inte getEffectivePermissions(): den senare bygger en
  // route-handler-klient, som försöker skriva cookies vid tokenförnyelse och därför inte hör hemma
  // i en server-komponent.
  const supabase = createServerComponentClient({ cookies });
  const { data: permissions } = await supabase.rpc('effective_permissions');
  const canReportTime = Array.isArray(permissions)
    && permissions.some((row) => (typeof row === 'string' ? row : String(row)) === 'time.approve');

  return <WorkOrderInstallerClient workOrderId={id} currentUserId={user.id} canReportTime={canReportTime} />;
}
