import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/route';
import NoAccess from './_components/NoAccess';
import { hasCrmPermissions } from '@/app/crm/lib/pagePermissions';
import SafetyRoundsListClient from './SafetyRoundsListClient';

export const dynamic = 'force-dynamic';

// Alla skyddsronder, senaste först, och starten av en ny på valfri arbetsorder. Tunn sida:
// inloggning och nyckel; listan hämtar klienten.
export default async function SafetyRoundsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  // Sidan avgör bara vad som RITAS. Varje rutt prövar nycklarna själv, och RLS en gång till. Läsning
  // = läs- ELLER skrivnyckeln, som i select-policyerna (se app/api/safety-rounds/_lib.ts).
  const keys = await hasCrmPermissions(['safety.round.read', 'safety.round.write']);
  if (!keys['safety.round.read'] && !keys['safety.round.write']) return <NoAccess />;

  return <SafetyRoundsListClient canWrite={keys['safety.round.write']} />;
}
