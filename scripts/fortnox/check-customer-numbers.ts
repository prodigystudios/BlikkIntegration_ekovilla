/**
 * Pekar våra kundkort på rätt kund i Fortnox? LÄSER BARA — skriver ingenting, varken i databasen eller i Fortnox.
 *
 *   PROD:    PROD_DB_URL satt i terminalen (samma som för db push), sedan
 *            npx -y tsx scripts/fortnox/check-customer-numbers.ts
 *   LOKALT:  npx -y tsx scripts/fortnox/check-customer-numbers.ts --local     (lokala databasen + testbolaget)
 *
 * Vad fynden betyder och varför frågan finns: lib/domains/fortnox/customerNumberCheck.ts.
 *
 * 🧨 TOKENEN FÖRNYAS ALDRIG HÄRIFRÅN. En förnyelse roterar refresh-tokenen; görs den utanför appen kopplas prod ur.
 * Skriptet lånar appens access-token medan den gäller (en timme efter varje förnyelse) och avbryter annars. Få appen
 * att förnya den: öppna CRM → Inställningar → Enheter i prod (sidan läser Fortnox), och kör skriptet direkt efteråt.
 *
 * Databasens URL delas upp i PG*-variabler åt psql: den hamnar aldrig i en kommandorad (`ps` visar argv) och skrivs
 * aldrig ut. Frågorna körs i en läs-transaktion (`set transaction read only`), så en skrivning nekas av databasen.
 *
 * Exitkod: 0 = alla kort stämmer, 2 = fynd att titta på, 1 = fel.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { abort, errorText } from './testCompany';
import { FORTNOX_API_BASE } from '@/lib/domains/fortnox/client';
import {
  checkCustomerLinks,
  type CustomerLinkFinding,
  type FortnoxListedCustomer,
  type LinkedCustomerRow,
} from '@/lib/domains/fortnox/customerNumberCheck';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
// Körningen tar några sekunder. 🧨 Gränsen måste ligga UNDER appens förnyelsemarginal (TOKEN_EXPIRY_BUFFER_MS, 5 min i
// lib/domains/fortnox/client.ts): appen förnyar först när mindre än så återstår. Låg gränsen över hade det funnits ett
// glapp där Enheter-sidan inte förnyar något och skriptet ändå vägrar.
const MIN_TOKEN_MINUTES = 3;
// Fortnox tillåter ~4 anrop/s.
const PAUSE_MS = 300;
const PSQL = existsSync('/opt/homebrew/opt/libpq/bin/psql') ? '/opt/homebrew/opt/libpq/bin/psql' : 'psql';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** URL:en som PG*-variabler: lösenordet går till psql via miljön, aldrig via argv. */
function pgEnv(dbUrl: string): { env: NodeJS.ProcessEnv; host: string } {
  let url: URL;
  try {
    url = new URL(dbUrl);
  } catch {
    abort('Databas-URL:en går inte att tolka. (Den skrivs inte ut.)');
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  return {
    host: url.hostname,
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
      PGSSLMODE: url.searchParams.get('sslmode') ?? (local ? 'disable' : 'require'),
      PGAPPNAME: 'check-customer-numbers',
    },
  };
}

/** En SELECT som ger EN json-cell, i en läs-transaktion. */
function queryJson<T>(env: NodeJS.ProcessEnv, sql: string): T {
  try {
    const out = execFileSync(
      PSQL,
      ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-c', 'set transaction read only', '-c', sql],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 },
    );
    return JSON.parse(out.trim() || 'null') as T;
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr?.trim();
    abort(`Databasfrågan föll: ${stderr || errorText(e)}`);
  }
}

async function fortnoxFetch(path: string, token: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${FORTNOX_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status !== 429 || attempt >= 5) {
      if (res.status === 401) {
        abort('Fortnox nekade tokenen (401) — den har förnyats eller dragits in under körningen. '
          + 'Öppna Inställningar → Enheter i appen igen och kör om.');
      }
      return res;
    }
    await res.text().catch(() => {});
    await sleep(Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt);
  }
}

async function listFortnoxCustomers(token: string): Promise<FortnoxListedCustomer[]> {
  const all: FortnoxListedCustomer[] = [];
  let total = 0;
  for (let page = 1, pages = 1; page <= pages; page++) {
    const res = await fortnoxFetch(`/customers?limit=500&page=${page}&sortby=customernumber&sortorder=ascending`, token);
    if (!res.ok) abort(`Fortnox GET /customers sida ${page} svarade ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as {
      Customers?: { CustomerNumber: string | number; Name?: string | null; OrganisationNumber?: string | null }[];
      MetaInformation?: { '@TotalPages'?: number; '@TotalResources'?: number };
    };
    pages = body.MetaInformation?.['@TotalPages'] ?? 1;
    total = body.MetaInformation?.['@TotalResources'] ?? total;
    for (const c of body.Customers ?? []) {
      all.push({ CustomerNumber: String(c.CustomerNumber), Name: c.Name ?? null, OrganisationNumber: c.OrganisationNumber ?? null });
    }
    await sleep(PAUSE_MS);
  }
  if (total && all.length !== total) abort(`Fortnox sa ${total} kunder men listan gav ${all.length}. Kör om.`);
  return all;
}

/**
 * Kundlistan är bekräftad mot testbolaget, men inte att den tar med INAKTIVA kunder. Ett nummer som saknas i listan
 * slås därför upp ett och ett: först 404 bevisar att kunden är borta. Finns den, jämförs den som vanligt.
 */
async function confirmMissing(token: string, numbers: string[]): Promise<FortnoxListedCustomer[]> {
  const found: FortnoxListedCustomer[] = [];
  for (const number of numbers) {
    const res = await fortnoxFetch(`/customers/${encodeURIComponent(number)}`, token);
    if (res.ok) {
      const { Customer: c } = (await res.json()) as { Customer: { Name?: string | null; OrganisationNumber?: string | null } };
      found.push({ CustomerNumber: number, Name: c.Name ?? null, OrganisationNumber: c.OrganisationNumber ?? null });
    } else if (res.status !== 404) {
      abort(`Fortnox GET /customers/${number} svarade ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    await sleep(PAUSE_MS);
  }
  return found;
}

function cardName(row: LinkedCustomerRow): string {
  const name = row.customer_type === 'business'
    ? row.company_name
    : [row.first_name, row.last_name].filter(Boolean).join(' ');
  return name?.trim() || '(namn saknas)';
}

function cardIdNumber(row: LinkedCustomerRow): string {
  return (row.customer_type === 'business' ? row.organization_number : row.personal_number) || 'inget nr';
}

function linked(row: LinkedCustomerRow): string {
  const parts = [
    row.quotes ? `${row.quotes} ${row.quotes === 1 ? 'offert' : 'offerter'}` : null,
    row.work_orders ? `${row.work_orders} ${row.work_orders === 1 ? 'arbetsorder' : 'arbetsordrar'}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'inga offerter eller arbetsordrar';
}

function printFinding(f: CustomerLinkFinding) {
  const row = f.row;
  console.log(`  Kortet:  ${cardName(row)} (${cardIdNumber(row)}) — /crm/kunder/${row.id} — ${linked(row)}`);
  if (f.kind === 'other_customer') {
    console.log(`  Fortnox ${row.fortnox_customer_id}: ${f.fortnox.Name ?? '(namn saknas)'} (${f.fortnox.OrganisationNumber || 'inget nr'})`);
  } else {
    const elsewhere = f.sameNumberElsewhere.map((c) => `${c.CustomerNumber} (${c.Name ?? '?'})`).join(', ');
    console.log(`  Fortnox ${row.fortnox_customer_id}: finns inte${elsewhere ? ` — samma org.nr finns som ${elsewhere}` : ''}`);
  }
  console.log('');
}

async function main() {
  const local = process.argv.includes('--local');
  const dbUrl = local ? LOCAL_DB_URL : process.env.PROD_DB_URL;
  if (!dbUrl) abort('PROD_DB_URL är inte satt i den här terminalen. Sätt den som för db push, eller kör med --local.');
  const { env, host } = pgEnv(dbUrl);
  console.log(`\nFortnox-kopplingarna — ${local ? 'LOKALT' : 'PROD'} (${host}). Läser bara.\n`);

  const token = queryJson<{ access_token: string | null; expires_at: string | null } | null>(env,
    `select json_build_object('access_token', access_token, 'expires_at', expires_at)
       from fortnox_integrations where provider = 'fortnox'`);
  if (!token?.access_token || !token.expires_at) abort('Fortnox är inte kopplat i den här databasen.');
  const minutesLeft = Math.floor((new Date(token.expires_at).getTime() - Date.now()) / 60_000);
  if (minutesLeft < MIN_TOKEN_MINUTES) {
    abort(`Appens Fortnox-token ${minutesLeft < 0 ? `gick ut för ${-minutesLeft} min sedan` : `gäller bara ${minutesLeft} min till`}, `
      + 'och skriptet förnyar den aldrig själv (det skulle koppla ur appen). Öppna Inställningar → Enheter i '
      + `${local ? 'den lokala appen' : 'prod'} — sidan läser Fortnox och appen förnyar tokenen — och kör om direkt.`);
  }
  console.log(`Tokenen gäller ${minutesLeft} min till. Ingen förnyelse görs.`);

  const rows = queryJson<LinkedCustomerRow[]>(env, `
    select coalesce(json_agg(r order by r.fortnox_customer_id), '[]'::json) from (
      select c.id, c.customer_type, c.company_name, c.first_name, c.last_name,
             c.organization_number, c.personal_number, btrim(c.fortnox_customer_id) as fortnox_customer_id,
             (select count(*) from crm_quotes q where q.customer_id = c.id or q.prospect_id = c.id)::int as quotes,
             (select count(*) from crm_work_orders w where w.customer_id = c.id or w.prospect_id = c.id)::int as work_orders
        from crm_customers c
       where c.fortnox_customer_id is not null and btrim(c.fortnox_customer_id) <> ''
    ) r`);

  const listed = await listFortnoxCustomers(token.access_token);
  console.log(`Fortnox: ${listed.length} kunder. Våra kort med Fortnox-nummer: ${rows.length}.`);

  const listedNumbers = new Set(listed.map((c) => c.CustomerNumber.trim()));
  const missing = rows.map((r) => r.fortnox_customer_id).filter((n) => !listedNumbers.has(n));
  const unlisted = missing.length ? await confirmMissing(token.access_token, missing) : [];
  if (unlisted.length) console.log(`(${unlisted.length} nummer fanns inte i listan men gick att slå upp — troligen inaktiva.)`);

  const report = checkCustomerLinks(rows, [...listed, ...unlisted]);
  console.log(`\n${report.ok} av ${report.checked} kort stämmer.\n`);
  if (report.findings.length === 0) return;

  const groups: [string, (f: CustomerLinkFinding) => boolean][] = [
    ['PEKAR PÅ EN ANNAN KUND — org.nr skiljer (säkert)',
      (f) => f.kind === 'other_customer' && f.basis === 'org_number'],
    ['PEKAR KANSKE PÅ EN ANNAN KUND — namnet skiljer, inget org.nr att jämföra (kan också vara ett namnbyte)',
      (f) => f.kind === 'other_customer' && f.basis === 'name'],
    ['NUMRET FINNS INTE I FORTNOX — kunden borttagen där; numret kan gå till nästa nya kund',
      (f) => f.kind === 'missing_in_fortnox'],
  ];
  for (const [title, match] of groups) {
    const hits = report.findings.filter(match);
    if (hits.length === 0) continue;
    console.log(`== ${title}: ${hits.length}\n`);
    hits.forEach(printFinding);
  }
  process.exitCode = 2;
}

main().catch((e) => abort(errorText(e)));
