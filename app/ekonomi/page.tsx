import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import PageShell from '@/components/ui/PageShell';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
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
  // EN klient för både sessionen och behörigheterna. Att kalla getCurrentUser() här hade byggt en
  // route-handler-klient — precis det kommentaren ovan säger att man inte får göra i en
  // server-komponent — och en cookie-skrivning vid tokenförnyelse hade kastat mitt i renderingen,
  // så sidan svarat 500 i stället för att skicka någon till inloggningen.
  const supabase = createServerComponentClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const { data: permissions } = await supabase.rpc('effective_permissions');
  // Fail-closed: ett fel ger `null`, som inte är en array, som blir false. Ett trasigt RPC-anrop
  // ska stänga dörren — inte lämna den på glänt.
  const held = new Set(
    Array.isArray(permissions) ? permissions.map((row) => (typeof row === 'string' ? row : String(row))) : [],
  );

  // ⚠️ BÅDA NYCKLARNA, inte bara time.approve. Ytan är två läsningar med var sin vakt:
  // månadsöversikten går genom RPC:n time_approval_overview (time.approve), och att fälla ut en
  // person går genom /api/admin/time/entries (time.entry.read.all, eftersom det är den nyckeln RLS
  // öppnar andras rader på). Med bara den ena laddar listan men varje utfälld person svarar
  // "Forbidden" — en halvtrasig sida i stället för ett tydligt nekande.
  //
  // Rollerna `ekonomi` och `admin` har båda nycklarna seedade, så villkoret biter bara den som fått
  // en enstaka nyckel via set_user_permission. Recepten i PERMISSIONS.md och TIME_AND_PAYROLL.md
  // ger därför båda.
  if (!held.has('time.approve') || !held.has('time.entry.read.all')) redirect('/');

  return (
    // Samma skal som AdminTabsClient ger fliken: PageShell + `crm.card`. Komponenten bär sin egen
    // padding (p-5) med flit och förutsätter ett kort att sitta i — utan det ligger den direkt på
    // sidans sage-bakgrund utan avgränsning och utan maxbredd.
    <PageShell className="max-w-[1460px]">
      <section className={cn(crm.cardInner, 'grid gap-4')}>
        <h1 className={cn('m-0', crm.pageTitle)}>Tid &amp; lön</h1>
      </section>
      <section className={crm.card}>
        <TimeApprovals />
      </section>
    </PageShell>
  );
}
