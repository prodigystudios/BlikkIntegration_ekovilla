import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/route';
import { hasCrmPermissions } from '@/app/crm/lib/pagePermissions';
import WorkOrderInstallerClient from '../WorkOrderInstallerClient';

export const dynamic = 'force-dynamic';

// Field view for installers (and anyone). Lives outside /crm (which is office-only) so
// member-role staff can open it via a direct link. Read-only essentials + write on
// time/comments; editing the order stays in /crm/arbetsorder/[id] for CRM roles.
export default async function InstallerWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ segment?: string }>;
}) {
  const { id } = await params;
  // Vilken PLACERING besättningen kom ifrån. Feeden skickar den; en direktlänk gör det inte, och
  // då visas hela ordern precis som förut. Vidare till klienten som bara läser den — uppslaget
  // segment → etapp görs av /field-scope, som äger både åtkomstprövningen och elevationen.
  const { segment } = await searchParams;
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
  // hasCrmPermissions läser alla nycklarna på EN rundtur och failar stängt (allt false) vid ett fel.
  const keys = await hasCrmPermissions(['time.approve', 'safety.round.read', 'safety.round.write']);
  const canReportTime = keys['time.approve'];
  // Skyddsronden ritas bara för den som har en av dess nycklar — rondledaren, ofta en arbetsledare
  // som fått dem personligt. Ingen besättningsgren: att köra jobbet ger inte rätt att leda ronden.
  const showSafetyRounds = keys['safety.round.read'] || keys['safety.round.write'];

  return (
    <WorkOrderInstallerClient
      workOrderId={id}
      segmentId={typeof segment === 'string' ? segment : null}
      currentUserId={user.id}
      canReportTime={canReportTime}
      showSafetyRounds={showSafetyRounds}
    />
  );
}
