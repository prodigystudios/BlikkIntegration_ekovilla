import type { SupabaseClient } from '@supabase/supabase-js';

// Traktamenten, utlägg och milersättning — egna poster, inte fält på tidraden.
//
// Lönebyrån bad om "traktamenten, utlägg, milersättning med belopp och datum" (2026-08-11). De har
// egna datum och hör inte till ett visst arbetspass: ett utlägg kan finnas en dag man inte jobbat.
//
// `quantity` (mil eller dagar) och `amount` (kronor) lagras BÅDA. Vem som fyller i beloppet är en
// fråga om formuläret; i dag skriver den anställde det själv och ingen sats finns i koden. Skulle
// systemet en dag räkna ut milersättningen ur en sats ska beloppet ändå lagras — annars ändras
// gamla månaders underlag retroaktivt när satsen justeras.
//
// KVITTO OCH MOMS (2026-08-22) hör till UTLÄGG och bara dit. Kvittot är kolumner på posten och inte
// en sidotabell — skälet står i supabase/sql/20260822_time_compensation_receipts.sql, kort: bara så
// fryser kvittot med perioden av sig självt. Ett utlägg utan kvitto går att spara, men flaggas
// (isReceiptMissing) i både /tid och attesten så kontoret hinner jaga pappret före låsningen.
// Lagring och sökvägar bor i lib/domains/time/receipts.ts.

export const COMPENSATION_KINDS = ['travel', 'per_diem', 'expense'] as const;
export type CompensationKind = (typeof COMPENSATION_KINDS)[number];

export const COMPENSATION_LABELS: Record<CompensationKind, string> = {
  travel: 'Milersättning',
  per_diem: 'Traktamente',
  expense: 'Utlägg',
};

// Enheten `quantity` mäts i, per sort. Utlägg har ingen — där är beloppet hela sanningen.
export const COMPENSATION_UNITS: Record<CompensationKind, string | null> = {
  travel: 'mil',
  per_diem: 'dagar',
  expense: null,
};

// ⚠️ INGEN `receipt_bucket`/`receipt_path` HÄR. Lagringens koordinater är serverns ensak: klienten
// har ingen användning för dem (kvittot öppnas via /api/time/compensations/<id>/receipt, som gatar
// om åtkomsten vid varje klick), och en sökväg som ändå aldrig behövs på klienten ska inte ligga i
// ett JSON-svar som passerar loggar och webbläsarhistorik. Servern hämtar dem separat med
// getCompensationReceiptRef när den faktiskt ska signera eller städa.
export const compensationSelect =
  'id, user_id, entry_date, kind, quantity, amount, vat_amount, note, ' +
  'receipt_name, receipt_content_type, receipt_size_bytes, receipt_uploaded_at, created_at, updated_at';

// Serverns vy: bara det som behövs för att signera eller radera lagringsobjektet.
// `kind` är med för att PATCH ska kunna hålla regeln "moms och kvitto bara på utlägg" även när
// kroppen inte säger något om sorten. Databasen har inget villkor som gör det åt oss.
export const compensationReceiptRefSelect =
  'id, kind, receipt_bucket, receipt_path, receipt_name, receipt_content_type';

export type CompensationItem = {
  id: string;
  user_id: string;
  entry_date: string;
  kind: CompensationKind;
  quantity: number | null;
  amount: number;
  // Momsen i kronor, inte en sats: ett kvitto kan bära 25, 12 och 6 procent på samma papper. null
  // betyder "inte ifylld" och är något annat än 0 — skillnaden är hela poängen för den som bokför.
  vat_amount: number | null;
  note: string | null;
  // Kvittots visningsnamn. Att det finns ETT namn är också svaret på "finns det ett kvitto?" —
  // se hasReceipt nedan.
  receipt_name: string | null;
  receipt_content_type: string | null;
  receipt_size_bytes: number | null;
  receipt_uploaded_at: string | null;
  created_at?: string;
  updated_at?: string;
};

// Serverns referens till lagringsobjektet. Lämnar aldrig en route.
export type CompensationReceiptRef = {
  id: string;
  kind: CompensationKind;
  receipt_bucket: string | null;
  receipt_path: string | null;
  receipt_name: string | null;
  receipt_content_type: string | null;
};

export type CompensationInput = {
  entry_date: string;
  kind: CompensationKind;
  quantity?: number | null;
  amount: number;
  vat_amount?: number | null;
  note?: string | null;
};

// Kvittots kolumner, satta i ett svep. Skrivs bara av routen efter att sökvägen prövats mot
// isReceiptPath och objektet lästs ur lagringen — aldrig direkt ur en request-kropp.
export type CompensationReceiptPatch = {
  receipt_bucket: string | null;
  receipt_path: string | null;
  receipt_name: string | null;
  receipt_content_type: string | null;
  receipt_size_bytes: number | null;
  receipt_uploaded_at: string | null;
};

// Nollställning av kvittofälten. Egen konstant för att alla sex kolumner ska falla samtidigt — en
// bortglömd kolumn hade lämnat en rad som påstår sig ha ett kvitto vars objekt inte finns.
export const EMPTY_RECEIPT: CompensationReceiptPatch = {
  receipt_bucket: null,
  receipt_path: null,
  receipt_name: null,
  receipt_content_type: null,
  receipt_size_bytes: null,
  receipt_uploaded_at: null,
};

// Ett utlägg utan kvitto är inte ogiltigt, men det ska synas. Härledd på ETT ställe så att /tid och
// attesten aldrig kan svara olika på samma post.
//
// Bara `expense`: traktamente räknas i dagar och milersättning i mil, och inget av dem har ett
// kvitto att lämna in. En flagga på dem hade varit brus som lär folk att ignorera flaggan.
export function isReceiptMissing(item: Pick<CompensationItem, 'kind' | 'receipt_name'>): boolean {
  return item.kind === 'expense' && !item.receipt_name;
}

export function hasReceipt(item: Pick<CompensationItem, 'receipt_name'>): boolean {
  return !!item.receipt_name;
}

export async function listCompensations(
  supabase: SupabaseClient,
  range: { from: string; to: string },
  opts?: { userId?: string },
) {
  let query = supabase
    .from('crm_time_compensations')
    .select(compensationSelect)
    .gte('entry_date', range.from)
    .lte('entry_date', range.to)
    .order('entry_date', { ascending: true });

  // Utan userId begränsar RLS ändå till den egna raden, om man inte har time.entry.read.all.
  if (opts?.userId) query = query.eq('user_id', opts.userId);

  return query;
}

// Kvittokolumnerna är med i typen, inte insmugna via en spread. `let receiptColumns = {}` i routen
// hade annars gett TypeScript ingenting att kontrollera — kolumnerna landade i databasen men fanns
// inte i någon signatur, och ett stavfel (`receipt_pathh`) hade passerat type-check tyst och skapat
// en post vars kvitto inte går att öppna.
export async function createCompensation(
  supabase: SupabaseClient,
  userId: string,
  input: CompensationInput & Partial<CompensationReceiptPatch>,
) {
  return supabase
    .from('crm_time_compensations')
    .insert({ ...input, user_id: userId })
    .select(compensationSelect)
    .single();
}

// Ägarskopad, som tidraderna: en icke-ägares id matchar helt enkelt ingen rad.
export async function updateCompensation(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  input: Partial<CompensationInput> & Partial<CompensationReceiptPatch>,
) {
  return supabase
    .from('crm_time_compensations')
    .update(input)
    .eq('id', id)
    .eq('user_id', userId)
    .select(compensationSelect)
    .maybeSingle();
}

// ⚠️ RETURNERAR KVITTOTS KOORDINATER, inte bara id:t. Routen behöver dem för att kunna radera
// lagringsobjektet efteråt — utan dem blir varje borttagen post en föräldralös bild i bucketen som
// ingen någonsin kan nå eller städa. Fälten går inte vidare i svaret.
export async function deleteCompensation(supabase: SupabaseClient, id: string, userId: string) {
  return supabase
    .from('crm_time_compensations')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select(compensationReceiptRefSelect)
    .maybeSingle();
}

// Var ligger den här postens kvitto? Ägarskopad, som allt annat skrivnära: en icke-ägares id
// matchar ingen rad. Används före en ersättning (för att kunna städa det gamla objektet) och före
// en signering.
//
// SELECT-policyn bär inget periodlås, så den här läsningen fungerar även i en inlämnad månad. Det
// är avsiktligt: att TITTA på kvittot i ett attesterat underlag är precis vad kontoret ska göra.
export async function getCompensationReceiptRef(supabase: SupabaseClient, id: string, opts?: { userId?: string }) {
  let query = supabase.from('crm_time_compensations').select(compensationReceiptRefSelect).eq('id', id);
  if (opts?.userId) query = query.eq('user_id', opts.userId);
  return query.maybeSingle();
}

// Är sökvägen redan kopplad till en post? Sökvägen är ägarscopad (Kvitton/<user_id>/...) och har
// prövats mot isReceiptPath innan den kommer hit, så varje träff är per definition en av den här
// användarens egna rader och därmed synlig genom RLS — sessionsklienten räcker.
//
// Kontrollen är inte en dubblettstädning utan en spärr: utan den kan samma objekt bäras av två
// poster, och då raderar den som tar bort den ena bilden under fötterna på den andra. Det unika
// indexet crm_time_compensations_receipt_path_key stänger kapplöpningen mellan kontrollen och
// skrivningen.
export async function findCompensationByReceiptPath(supabase: SupabaseClient, path: string) {
  return supabase
    .from('crm_time_compensations')
    .select('id')
    .eq('receipt_path', path)
    .maybeSingle();
}

export type CompensationTotals = {
  kind: CompensationKind;
  quantity: number;
  amount: number;
  vat: number;
  count: number;
  // Antal poster av sorten som borde ha ett kvitto men saknar det. Alltid 0 för traktamente och
  // milersättning, se isReceiptMissing.
  missingReceipts: number;
};

// Summering per sort för underlagets ersättningsdel. Ren funktion — testbar utan databas.
export function summarizeCompensations(items: CompensationItem[]): CompensationTotals[] {
  const totals = new Map<CompensationKind, CompensationTotals>();
  for (const item of items) {
    const current = totals.get(item.kind)
      ?? { kind: item.kind, quantity: 0, amount: 0, vat: 0, count: 0, missingReceipts: 0 };
    current.quantity += Number(item.quantity ?? 0);
    // Number() och inte + : Postgres numeric kommer tillbaka som sträng via PostgREST, och
    // '120.50' + '80.25' hade blivit '120.5080.25'.
    current.amount += Number(item.amount ?? 0);
    // `?? 0` och inte `Number(x) || 0`: skillnaden mellan "moms saknas" och "moms är noll" bevaras i
    // isVatMissing nedan, men i en SUMMA är båda värda noll kronor. Den som vill veta hur många som
    // saknas frågar count/missing, inte summan.
    current.vat += Number(item.vat_amount ?? 0);
    current.count += 1;
    if (isReceiptMissing(item)) current.missingReceipts += 1;
    totals.set(item.kind, current);
  }
  return COMPENSATION_KINDS.map((kind) => totals.get(kind)).filter(Boolean) as CompensationTotals[];
}

// Hur många poster i urvalet saknar sitt kvitto? Attesten frågar det per person och period, /tid
// frågar det per månad — samma härledning på båda ställena.
export function countMissingReceipts(items: Pick<CompensationItem, 'kind' | 'receipt_name'>[]): number {
  return items.reduce((count, item) => count + (isReceiptMissing(item) ? 1 : 0), 0);
}

/**
 * Momsvillkoret i databasen (crm_time_compensations_vat_amount_chk) på begripligt svenska.
 *
 * En CHECK-överträdelse är SQLSTATE 23514 med Postgres egen engelska text. Utan den här mappningen
 * blir en felskriven moms ett rått 500 — och 500 läser som "systemet är trasigt" när det i själva
 * verket var användaren som skrev 250 där det skulle stå 25.
 *
 * ⚠️ Villkoret kan slå från BÅDA hållen: att höja momsen över beloppet, och att sänka BELOPPET
 * under en moms som redan står på raden. Den andra vägen är inte hypotetisk — en PATCH som bara
 * skickar `amount` ser inte momsen alls, så routen kan omöjligt förvarna. Meddelandet nämner därför
 * båda fälten.
 */
export function compensationConstraintError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return null;
  if (error.code !== '23514') return null;
  if (!String(error.message || '').includes('vat_amount')) return null;
  return {
    status: 400 as const,
    code: 'time_compensation_vat_invalid',
    message: 'Momsen kan inte vara högre än beloppet. Kontrollera både moms och belopp.',
  };
}
