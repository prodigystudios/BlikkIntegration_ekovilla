import { createSessionClient } from '@/lib/supabase/session';
import { cookies } from 'next/headers';

// Vem tittar på ekonomiytan, och vad får de se?
//
// Ytan har två halvor med var sin nyckeluppsättning — löneunderlaget och fakturaunderlaget — och
// båda sidorna behöver samma två svar: är du inloggad, och vad håller du? Läsningen bor här så att
// de inte driver isär. Det var precis så skrivspärren en gång hamnade i två oberoende kopior som
// vaktade olika vägar till samma tabeller.
//
// Läser `effective_permissions` själv i stället för via getEffectivePermissions(). Skälet var att den
// senare byggde en route-handler-klient som kastade vid tokenförnyelse i en server-komponent — borta
// sedan bytet till @supabase/ssr. Sammanslagningen av läsningarna hör till RBAC-passet.
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
  const supabase = createSessionClient();
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
 * ⛔ Frågar EFTER `crm.workorder.read` och inte efter den grova `crm.access`. Nyckeln gör båda
 * jobben: den är vad RLS öppnar orderraderna på, och sedan 2026-09-18 vad arbetsorderrutterna
 * själva grindar på. `crm.access` hade dessutom öppnat /api/crm/reports, /sellers och
 * /calc-settings — tre rutter som läser med getSupabaseAdmin(), alltså förbi RLS. En extern part
 * ska inte få företagets försäljningssiffror och inköpspriser på köpet av en orderlista.
 *
 * ⛔ Ingen SKRIVNYCKEL efterfrågas, och ingen ska läggas till här — inte heller som ett "eller".
 * En skrivnyckel är inte ett bevis på läsrätt: den som får skriva utan att ha läsnyckeln möts av en
 * sida där RLS filtrerar bort varenda rad, vilket ser ut som att det inte finns några ordrar.
 * Byrån läser underlaget; kontoret äger ordern. Se 20260918_ekonomi_work_order_read.sql.
 */
export function canReadWorkOrders(held: Set<string>): boolean {
  return held.has('crm.workorder.read');
}
