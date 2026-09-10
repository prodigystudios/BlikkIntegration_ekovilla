import type { SupabaseClient } from '@supabase/supabase-js';

// Väntade leveranser: material som är beställt men ännu inte står på depån.
//
// 🧨 RÖR ALDRIG LAGERSALDOT. Saldot är levererat − förbrukat och räknas i computeDepotBalances ur
// ops_depot_deliveries. Ingen funktion här får skriva dit — utom kvitteringen, som går via en RPC
// och då skapar en riktig leveransrad. Räknades väntat material som lager skulle bristvarningen
// slockna så fort någon lagt in en beställning, oavsett om fabriken levererar.
//
// Rena hjälpare enhetstestas; DB-funktionerna är tunna RLS-avgränsade läsningar och skrivningar.

export type ExpectedDeliveryStatus = 'expected' | 'arrived' | 'cancelled';

export type ExpectedDelivery = {
  id: string;
  depot_id: string;
  depot_name: string;
  material: string;
  sacks: number;
  expected_on: string; // 'YYYY-MM-DD'
  note: string | null;
  status: ExpectedDeliveryStatus;
};

type ReadError = { message: string } | null;

const SELECT = 'id, depot_id, material, sacks, expected_on, note, status, depot:ops_depots(name)';

function toExpected(row: Record<string, any>): ExpectedDelivery {
  const depot = Array.isArray(row.depot) ? row.depot[0] : row.depot;
  return {
    id: row.id as string,
    depot_id: row.depot_id as string,
    depot_name: (depot?.name as string) ?? 'Okänd depå',
    material: row.material as string,
    sacks: Number(row.sacks),
    expected_on: row.expected_on as string,
    note: (row.note as string | null) ?? null,
    status: (row.status as ExpectedDeliveryStatus) ?? 'expected',
  };
}

/**
 * Pure: kan raden tas emot?
 *
 * Skiljer på de tre nekandena, för de betyder olika saker för den som tryckte: en redan kvitterad
 * rad är någon annans arbete som just blev klart, en avbruten är ett aktivt beslut. Speglar
 * `expected_not_open` i receive_expected_delivery — grinden som räknas sitter i databasen, det här
 * är gränssnittets halva.
 */
export function canReceiveExpected(status: ExpectedDeliveryStatus): 'ok' | 'already_arrived' | 'cancelled' {
  if (status === 'arrived') return 'already_arrived';
  if (status === 'cancelled') return 'cancelled';
  return 'ok';
}

/**
 * Väntade leveranser vars datum faller i [from, to]. RLS (planning.schedule.read).
 *
 * Bara `expected`: en kvitterad rad syns på tavlan som sin LAGERRAD i stället, och en avbruten ska
 * inte synas alls. Kom båda med skulle samma leverans ritas två gånger samma dag.
 */
export async function listExpectedInRange(
  supabase: SupabaseClient,
  range: { from: string; to: string },
): Promise<{ data: ExpectedDelivery[]; error: ReadError }> {
  const { data, error } = await supabase
    .from('ops_expected_deliveries')
    .select(SELECT)
    .eq('status', 'expected')
    .gte('expected_on', range.from)
    .lte('expected_on', range.to)
    .order('expected_on', { ascending: true })
    .order('id', { ascending: true });
  if (error) return { data: [], error };
  return { data: ((data ?? []) as Array<Record<string, any>>).map(toExpected), error: null };
}

export type CreateExpectedInput = {
  depotId: string;
  material: string;
  sacks: number;
  expectedOn: string;
  note: string | null;
  actorUserId: string;
};

// created_by måste vara anroparen (RLS insert-policyn kräver created_by = auth.uid()).
export async function createExpectedDelivery(supabase: SupabaseClient, input: CreateExpectedInput) {
  return supabase
    .from('ops_expected_deliveries')
    .insert({
      depot_id: input.depotId,
      material: input.material,
      sacks: input.sacks,
      expected_on: input.expectedOn,
      note: input.note,
      created_by: input.actorUserId,
    })
    .select(SELECT)
    .single();
}

// Avbryt en väntad leverans. Raden raderas inte — den är revision över vad vi trodde skulle komma.
export async function cancelExpectedDelivery(supabase: SupabaseClient, id: string) {
  return supabase
    .from('ops_expected_deliveries')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'expected') // en redan kvitterad rad får inte gå att avbryta i efterhand
    .select('id, status')
    .maybeSingle();
}

export type ReceiveExpectedInput = {
  expectedId: string;
  deliveredOn: string;
  sacks: number;
  note: string | null;
};

/**
 * Kvittera ankomst: skapar lagerraden OCH stänger den väntade raden, i EN transaktion.
 *
 * 🧨 SESSIONSKLIENTEN, ALDRIG ADMIN-KLIENTEN. Funktionen är SECURITY DEFINER och prövar
 * has_permission, som nycklar allt på auth.uid() — under service-role är den null och grinden nekar
 * alltid. Det felet var tyst i tre månader förra gången.
 *
 * Två skrivningar utan transaktion har ett fönster där samma säckar räknas både som lager och som
 * på väg (underbeställning, upptäcks när en bil står tom) eller varken eller.
 */
export async function receiveExpectedDelivery(
  supabase: SupabaseClient,
  input: ReceiveExpectedInput,
): Promise<{ deliveryId: string | null; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc('receive_expected_delivery', {
    p_expected_id: input.expectedId,
    p_delivered_on: input.deliveredOn,
    p_sacks: input.sacks,
    p_note: input.note,
  });
  if (error) return { deliveryId: null, error };
  return { deliveryId: (data as string) ?? null, error: null };
}
