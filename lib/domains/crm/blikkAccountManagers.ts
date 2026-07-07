import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getBlikk } from '@/lib/blikk';

// ─────────────────────────────────────────────────────────────────────────────
// Backfill av kundansvarig (account_manager_id) från Blikk.
//
// Blikk-kunderna har samma kundnummer som Fortnox → vi matchar Blikks kundnummer mot
// crm_customers.fortnox_customer_id. Ansvarig säljare i Blikk är ett Blikk-user-id, som
// översätts till en intern profil via profiles.blikk_id (samma mappning som "Blikk-koppling").
//
// Endast FÖRETAGSKUNDER importeras — privatpersoner filtreras bort via Blikks contactType
// redan på list-endpointen, innan någon detalj hämtas. Vid varje körning SKRIVS ansvarig
// ÖVER med Blikks värde (Blikk är källan).
//
// Resum-bar per Blikk-listsida (cursor = sidnummer). Route/UI loopar tills nextPage === null,
// likt "Verifiera kundtyper"-flödet för Fortnox.
//
// OBS: exakta Blikk-fältnamn bekräftas via probe-routen /api/blikk/contacts/probe (Steg 0).
// Extraktionen nedan är tolerant (provar flera kandidatnycklar) i samma anda som resten av
// lib/blikk.ts, så den är robust mot tenant-variationer.
// ─────────────────────────────────────────────────────────────────────────────

const DB_CONCURRENCY = 10;
const DETAIL_SPACING_MS = 300; // ~3 req/s — under Blikks rate-limit vid detalj-fan-out

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Kandidatnycklar (tolerant extraktion). Bekräftas/snävas via probe.
const CUSTOMER_NUMBER_KEYS = ['customerNumber', 'CustomerNumber', 'customerNo', 'number', 'no'];
const CONTACT_TYPE_KEYS = ['contactType', 'ContactType', 'type', 'Type'];
const SELLER_ID_KEYS = ['salesResponsibleId', 'salesUserId', 'responsibleId', 'responsibleUserId'];
const SELLER_OBJECT_KEYS = ['salesResponsible', 'salesUser', 'responsible', 'responsibleUser'];

function pickFrom(obj: any, keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

// Normalisera kundnummer till en stabil sträng för jämförelse mot fortnox_customer_id (text).
export function normalizeCustomerNumber(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

// Tolka Blikks contactType → är detta en företagskund? Hanterar sträng ('Company'/'Private'/
// 'Organization'/'Person'), objekt med name, samt numeriska koder om tenant använder sådana.
export function interpretIsCompany(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'object') {
    const name = (value as any).name ?? (value as any).Name ?? (value as any).type;
    return interpretIsCompany(name);
  }
  const s = String(value).trim().toLowerCase();
  if (!s) return false;
  if (/(company|organi[sz]ation|business|företag|foretag|firm)/.test(s)) return true;
  if (/(private|person|individual|privat)/.test(s)) return false;
  // Numerisk kod: bekräfta värdet via probe. Vanligt: 1 = företag. Fallback: ej företag.
  if (s === '1') return true;
  return false;
}

// Blikk-user-id för ansvarig säljare — från direkt fält eller nästlat objekt.
export function extractSellerBlikkId(raw: any): number | null {
  const direct = pickFrom(raw, SELLER_ID_KEYS);
  if (direct != null) {
    const n = Number(direct);
    if (Number.isFinite(n) && n > 0) return n;
  }
  for (const k of SELLER_OBJECT_KEYS) {
    const obj = raw?.[k];
    const id = pickFrom(obj, ['id', 'Id', 'userId']);
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export type NormalizedBlikkContact = {
  id: number | null;
  customerNumber: string | null;
  isCompany: boolean;
  sellerBlikkId: number | null;
};

export function normalizeBlikkContact(raw: any): NormalizedBlikkContact {
  return {
    id: Number.isFinite(Number(raw?.id ?? raw?.Id ?? raw?.contactId)) ? Number(raw?.id ?? raw?.Id ?? raw?.contactId) : null,
    customerNumber: normalizeCustomerNumber(pickFrom(raw, CUSTOMER_NUMBER_KEYS)),
    isCompany: interpretIsCompany(pickFrom(raw, CONTACT_TYPE_KEYS)),
    sellerBlikkId: extractSellerBlikkId(raw),
  };
}

export type AccountManagerResolution = {
  updates: { customerId: string; accountManagerId: string }[];
  unmappedSeller: { customerNumber: string; sellerBlikkId: number }[]; // säljare saknar blikk_id-koppling
  unmatchedCustomer: string[]; // företagskund i Blikk med kundnummer men ingen CRM-motsvarighet
  skippedPrivate: number;      // privatkontakter som filtrerats bort
  noSeller: string[];          // företagskund (kundnummer) utan ansvarig säljare i Blikk (rörs ej)
};

// Ren, testbar matchning. Ingen I/O. Filtrerar privat, matchar kundnummer → CRM-kund och
// säljare → profil. Företag utan ansvarig lämnas orörda (Blikk saknar värde att skriva).
export function resolveAccountManagerUpdates(
  contacts: NormalizedBlikkContact[],
  blikkIdToProfile: Map<number, string>,
  customerNumberToId: Map<string, string>,
): AccountManagerResolution {
  const res: AccountManagerResolution = {
    updates: [], unmappedSeller: [], unmatchedCustomer: [], skippedPrivate: 0, noSeller: [],
  };

  // Deduplicera per kund: två Blikk-kontakter kan dela kundnummer (samma företag, flera
  // kontaktrader). Utan detta skulle samma rad skrivas två gånger (icke-deterministisk
  // sist-vinner) och `updated` räknas dubbelt. Första träffen vinner.
  const seenCustomer = new Set<string>();

  for (const c of contacts) {
    if (!c.isCompany) { res.skippedPrivate++; continue; }
    if (!c.customerNumber) continue; // inget att matcha på
    const customerId = customerNumberToId.get(c.customerNumber);
    if (!customerId) { res.unmatchedCustomer.push(c.customerNumber); continue; }
    if (c.sellerBlikkId == null) { res.noSeller.push(c.customerNumber); continue; }
    const profileId = blikkIdToProfile.get(c.sellerBlikkId);
    if (!profileId) { res.unmappedSeller.push({ customerNumber: c.customerNumber, sellerBlikkId: c.sellerBlikkId }); continue; }
    if (seenCustomer.has(customerId)) continue; // redan schemalagd på denna sida
    seenCustomer.add(customerId);
    res.updates.push({ customerId, accountManagerId: profileId });
  }

  return res;
}

async function runInBatches<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    out.push(...await Promise.all(items.slice(i, i + batchSize).map(fn)));
  }
  return out;
}

// Kund vi kunde matcha mot CRM men INTE sätta ansvarig på — med namn så admin ser vilka.
export type UnresolvedCustomer = {
  customerNumber: string;
  customerName: string;
  reason: 'unmapped_seller' | 'no_seller';
  sellerBlikkId?: number; // endast för unmapped_seller
};

export type BlikkAccountManagerPageResult = {
  page: number;
  processed: number;              // antal Blikk-kontakter på sidan
  updated: number;                // antal kunder som fick account_manager_id satt
  unresolved: UnresolvedCustomer[]; // matchade CRM-kunder som inte fick ansvarig (med namn + orsak)
  unmatchedCustomer: string[];    // Blikk-företagskunder utan CRM-motsvarighet (bara kundnummer)
  skippedPrivate: number;
  detailFetches: number;          // antal detalj-anrop som behövdes (0 om list bär ansvarig)
  nextPage: number | null;        // cursor för nästa körning, null när klart
};

// Bearbeta EN Blikk-listsida. Route/UI loopar page 1,2,3… tills nextPage === null.
export async function syncBlikkAccountManagersPage(
  page = 1,
  pageSize = 100,
): Promise<BlikkAccountManagerPageResult> {
  const supabase = getSupabaseAdmin();
  const blikk = getBlikk();

  // Blikk-user-id → profil (litet team, en enkel fråga).
  const { data: profileRows, error: profErr } = await supabase
    .from('profiles')
    .select('id, blikk_id')
    .not('blikk_id', 'is', null);
  if (profErr) throw new Error(`Kunde inte läsa profil-mappning: ${profErr.message}`);
  const blikkIdToProfile = new Map<number, string>();
  for (const p of profileRows ?? []) {
    if (p.blikk_id != null) blikkIdToProfile.set(Number(p.blikk_id), p.id);
  }

  // Hämta en sida Blikk-kontakter och normalisera.
  const listData = await blikk.listContacts({ page, pageSize });
  const items: any[] = Array.isArray(listData) ? listData : (listData?.items || listData?.data || []);
  const normalized = items.map(normalizeBlikkContact);

  // Företagskunder med kundnummer → slå upp motsvarande CRM-kunder (bunden .in-fråga, ≤ pageSize).
  const companyNumbers = Array.from(new Set(
    normalized.filter((c) => c.isCompany && c.customerNumber).map((c) => c.customerNumber as string),
  ));
  const customerNumberToId = new Map<string, string>();
  const customerNumberToName = new Map<string, string>();
  if (companyNumbers.length > 0) {
    const { data: crmRows, error: crmErr } = await supabase
      .from('crm_customers')
      .select('id, fortnox_customer_id, company_name, first_name, last_name')
      .in('fortnox_customer_id', companyNumbers);
    if (crmErr) throw new Error(`Kunde inte läsa kunder: ${crmErr.message}`);
    for (const r of crmRows ?? []) {
      if (!r.fortnox_customer_id) continue;
      const key = String(r.fortnox_customer_id);
      customerNumberToId.set(key, r.id);
      const name = r.company_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || `Kund ${key}`;
      customerNumberToName.set(key, name);
    }
  }

  // Fyll i ansvarig från detaljen för matchande företagskunder som saknar säljare i listan.
  // (Om listan redan bär ansvarig görs inga detalj-anrop.)
  let detailFetches = 0;
  const needsDetail = normalized.filter(
    (c) => c.isCompany && c.customerNumber && customerNumberToId.has(c.customerNumber)
      && c.sellerBlikkId == null && c.id != null && c.id > 0,
  );
  for (const c of needsDetail) {
    try {
      const detail = await blikk.getContactById(c.id as number);
      const raw = (detail as any)?.contact?.raw ?? detail;
      c.sellerBlikkId = extractSellerBlikkId(raw);
      detailFetches++;
    } catch (e) {
      console.warn(`[Blikk kundansvarig] Kunde inte hämta kontakt ${c.id} (${(e as Error)?.message ?? e})`);
    }
    await sleep(DETAIL_SPACING_MS);
  }

  const resolution = resolveAccountManagerUpdates(normalized, blikkIdToProfile, customerNumberToId);

  // Skriv över account_manager_id per kund (matchat på id). Batchat mot DB.
  let updated = 0;
  if (resolution.updates.length > 0) {
    const results = await runInBatches(resolution.updates, DB_CONCURRENCY, async (u) => {
      const { error } = await supabase
        .from('crm_customers')
        .update({ account_manager_id: u.accountManagerId })
        .eq('id', u.customerId);
      if (error) {
        console.warn(`[Blikk kundansvarig] Kunde inte uppdatera kund ${u.customerId} (${error.message})`);
        return false;
      }
      return true;
    });
    updated = results.filter(Boolean).length;
  }

  // Berika de icke-lösta (matchade) kunderna med namn + orsak så admin ser exakt vilka.
  const nameOf = (num: string) => customerNumberToName.get(num) || `Kund ${num}`;
  const unresolved: UnresolvedCustomer[] = [
    ...resolution.unmappedSeller.map((u) => ({
      customerNumber: u.customerNumber, customerName: nameOf(u.customerNumber),
      reason: 'unmapped_seller' as const, sellerBlikkId: u.sellerBlikkId,
    })),
    ...resolution.noSeller.map((num) => ({
      customerNumber: num, customerName: nameOf(num), reason: 'no_seller' as const,
    })),
  ];

  // Fortsätt så länge sidan har rader; stanna först vid en TOM sida. (Att stanna på en
  // kort sida vore fel — Blikk/proxy kan returnera färre än pageSize på en icke-sista sida,
  // vilket tyst skulle hoppa över resten. Priset är ett extra tomt anrop i slutet.)
  const nextPage = items.length > 0 ? page + 1 : null;

  return {
    page,
    processed: items.length,
    updated,
    unresolved,
    unmatchedCustomer: resolution.unmatchedCustomer,
    skippedPrivate: resolution.skippedPrivate,
    detailFetches,
    nextPage,
  };
}
