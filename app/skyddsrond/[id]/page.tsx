import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/route';
import NoAccess from '../_components/NoAccess';
import { hasCrmPermissions } from '@/app/crm/lib/pagePermissions';
import SafetyRoundClient from './SafetyRoundClient';

export const dynamic = 'force-dynamic';

// En skyddsrond — formuläret som fylls i på plats. Tunn sida: inloggning och nyckel; resten hämtar
// klienten (useSafetyRound), som också får `can_write` ur rutten.
export default async function SafetyRoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  // Sidan avgör bara vad som RITAS. Varje rutt prövar nycklarna själv, och RLS en gång till. Läsning
  // = läs- ELLER skrivnyckeln, som i select-policyerna (se app/api/safety-rounds/_lib.ts).
  const keys = await hasCrmPermissions(['safety.round.read', 'safety.round.write']);
  if (!keys['safety.round.read'] && !keys['safety.round.write']) return <NoAccess />;

  return <SafetyRoundClient roundId={id} />;
}
