import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';

// Vem tittar på ekonomiytan, och vad får de se?
//
// Ytan har två halvor med var sin nyckeluppsättning — löneunderlaget och fakturaunderlaget — och
// båda sidorna behöver samma två svar: är du inloggad, och vad håller du? Läsningen bor här så att
// de inte driver isär. Det var precis så skrivspärren en gång hamnade i två oberoende kopior som
// vaktade olika vägar till samma tabeller.
//
// ⚠️ `createServerComponentClient` och INTE getEffectivePermissions(): den senare bygger en
// route-handler-klient som försöker skriva cookies vid tokenförnyelse och därför inte hör hemma i
// en server-komponent — den kastar mitt i renderingen och sidan svarar 500 i stället för att skicka
// någon till inloggningen. Samma skäl och samma mönster som app/arbetsorder/[id]/page.tsx.
//
// ⚠️ app/ekonomi/page.tsx gör i dag samma läsning inline, med sin egen utförliga motivering. Den är
// medvetet orörd: den fungerar, den bär lockout-resonemanget i klartext, och att skriva om en
// fungerande behörighetsgrind i samma ändring som en ny yta byggs är att blanda två sorters risk.
// Den flyttas hit när RBAC-arbetet ändå tar hela ytan.

export type EkonomiAccess = {
  /** null = inte inloggad. Anroparen ska då skicka till /auth/sign-in. */
  userId: string | null;
  /** De effektiva nycklarna. Tom mängd vid fel — fail-closed, se nedan. */
  held: Set<string>;
};

export async function readEkonomiAccess(): Promise<EkonomiAccess> {
  const supabase = createServerComponentClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { userId: null, held: new Set() };

  const { data: permissions } = await supabase.rpc('effective_permissions');
  // Fail-closed: ett fel ger `null`, som inte är en array, som blir en tom mängd. Ett trasigt
  // RPC-anrop ska stänga dörren — inte lämna den på glänt.
  const held = new Set(
    Array.isArray(permissions) ? permissions.map((row) => (typeof row === 'string' ? row : String(row))) : [],
  );
  return { userId: user.id, held };
}

/**
 * Löneunderlaget — attestvyn på /ekonomi.
 *
 * ⚠️ BÅDA NYCKLARNA. Ytan är två läsningar med var sin vakt: månadsöversikten går genom RPC:n
 * time_approval_overview (time.approve), och att fälla ut en person går genom
 * /api/admin/time/entries (time.entry.read.all, eftersom det är den nyckeln RLS öppnar andras rader
 * på). Med bara den ena laddar listan men varje utfälld person svarar "Forbidden".
 */
export function canReadPayroll(held: Set<string>): boolean {
  return held.has('time.approve') && held.has('time.entry.read.all');
}

/**
 * Fakturaunderlaget — arbetsordrarna på /ekonomi/arbetsorder.
 *
 * ⚠️ BÅDA NYCKLARNA, av samma skäl som ovan: `crm.access` är den grova grinden bakom
 * `requireCrmUser()` som varje CRM-route frågar efter, och `crm.workorder.read` är den RLS öppnar
 * orderraderna på. Med bara den första svarar listan 200 med noll rader — en tom sida som ser ut
 * som att det inte finns några ordrar. Med bara den andra svarar routen 403.
 *
 * ⛔ Ingen SKRIVNYCKEL efterfrågas, och ingen ska läggas till här. Byrån läser underlaget; kontoret
 * äger ordern. Vyerna renderas med readOnly och varje skrivingång är avstängd — se
 * 20260918_ekonomi_work_order_read.sql.
 */
export function canReadWorkOrders(held: Set<string>): boolean {
  return held.has('crm.access') && held.has('crm.workorder.read');
}
