import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { getCurrentUser } from '@/lib/auth/route';
import TimeApprovals from './TimeApprovals';

export const dynamic = 'force-dynamic';

// Tid & lön — lönebyråns yta.
//
// Samma komponent som Admin -> Attest renderar. Den ligger här och inte där för att det här är dess
// primära hem: personen som gör lönerna ska se en app med EN sak i, inte hitta rätt flik i en
// administrationsyta som också bär användarhantering och behörighetseditorn.
//
// ⚠️ GRINDEN ÄR EN BEHÖRIGHET, INTE EN ROLL. Skälet är att rollen och åtkomsten svarar på två olika
// frågor: `ekonomi` bär MENYN (app/_lib/appNav.ts gatar på roll), medan time.approve avgör vem som
// faktiskt får se allas timmar. Därför når admin sidan utan att byta roll, och en arbetsledare som
// får nyckeln per användarundantag —
//   select public.set_user_permission('<uuid>', 'time.approve', 'grant');
// — når den också, utan att någon behöver uppfinna en roll åt henne. Det är PERMISSIONS.md:s recept,
// och det fungerar bara om grinden frågar efter nyckeln.
//
// Följden, medveten: den som når sidan via ett användarundantag får INGEN menyrad, eftersom menyn
// gatar på roll. Hon når den genom att skriva adressen. Samma glapp som /tid har i dag.
//
// ⚠️ `createServerComponentClient` och INTE getEffectivePermissions(): den senare bygger en
// route-handler-klient som försöker skriva cookies vid tokenförnyelse och därför inte hör hemma i en
// server-komponent. Samma skäl och samma mönster som app/arbetsorder/[id]/page.tsx.
export default async function EkonomiPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const supabase = createServerComponentClient({ cookies });
  const { data: permissions } = await supabase.rpc('effective_permissions');
  // Fail-closed: ett fel ger `null`, som inte är en array, som blir false. Ett trasigt RPC-anrop
  // ska stänga dörren — inte lämna den på glänt.
  const canApprove = Array.isArray(permissions)
    && permissions.some((row) => (typeof row === 'string' ? row : String(row)) === 'time.approve');

  if (!canApprove) redirect('/');

  return <TimeApprovals />;
}
