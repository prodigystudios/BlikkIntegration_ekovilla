/**
 * Kopierar prods artiklar — den lokala cachen, laddad ur supabase/seed/articles.local.sql — till Fortnox
 * TESTBOLAG, så att offerter som pushas lokalt har artiklar att peka på.
 *
 *   npx -y tsx scripts/fortnox/copy-articles-to-test-company.ts           torrkörning, skriver inget
 *   npx -y tsx scripts/fortnox/copy-articles-to-test-company.ts --apply   skapar enheter och artiklar
 *
 * 🧨 Skriptet skriver i det Fortnox-bolag som den lokala databasen är kopplad till. Det vägrar därför om
 *   - databasen inte är lokal (.env.development.local måste finnas — utan den pekar .env.local på PROD), eller
 *   - Fortnox svarar med ett bolag som inte står i FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS.
 * Samma två frågor som spärren i OAuth-callbacken (lib/domains/fortnox/connectionGuard.ts).
 *
 * Bara artiklar som SAKNAS i testbolagets levande register skapas; befintliga rörs inte. Enheterna skapas
 * först, husarbete-flaggan sätts efter skapandet. Varje skapad artikel speglas in i den lokala cachen
 * (createFortnoxArticle gör det). Exitkoden är 1 om något misslyckades.
 */
import { loadEnvConfig } from '@next/env';
import type { FortnoxCompanySettingsResponse } from '@/lib/domains/fortnox/offerPdf';

// Samma filer och ordning som `next dev`: .env.development.local vinner över .env.local.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

// Fortnox tillåter ~4 anrop/s; en ny artikel kostar ~4 anrop. Pausen håller oss under taket i stället
// för att luta sig på 429-omförsöken, som ger upp efter fem försök.
const PAUSE_BETWEEN_ARTICLES_MS = 1000;
const CACHE_PAGE = 1000; // PostgREST kapar vid 1000 rader — läs sida för sida.

function abort(message: string): never {
  console.error(`\n⛔ ${message}\n`);
  process.exit(1);
}

/** Råa felet för en utvecklare — friendlyFortnoxMessage gör allt icke-Fortnox till "Något gick fel". */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 200) : String(e);
}

async function main() {
  const apply = process.argv.includes('--apply');

  // Importerna först NU: modulerna ska se miljön som laddades ovan.
  const { fortnoxConnectionPolicy, judgeFortnoxCompany, isLocalSupabaseUrl } = await import(
    '@/lib/domains/fortnox/connectionGuard'
  );
  const { fortnoxGet, fortnoxPut, fortnoxSleep, FortnoxApiError } = await import('@/lib/domains/fortnox/client');
  const { listFortnoxUnits, createFortnoxUnit } = await import('@/lib/domains/fortnox/units');
  const { listFortnoxPriceLists } = await import('@/lib/domains/fortnox/customers');
  const { createFortnoxArticle } = await import('@/lib/domains/fortnox/articles');
  const { planArticleCopy, pickDefaultPriceList } = await import('@/lib/domains/fortnox/articleCopy');
  const { getSupabaseAdmin } = await import('@/lib/supabase/server');

  // Spärr 1: databasen. Tokens och cache läses och skrivs här — den får aldrig vara prods.
  const dbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!isLocalSupabaseUrl(dbUrl)) abort(`Databasen är inte lokal (${dbUrl ?? 'ingen URL'}). Kör bara mot den lokala stacken.`);

  // Spärr 2: bolaget. Med en lokal databas är policyn alltid tillåtelselistan; frågan är vilket bolag
  // kopplingen faktiskt gäller.
  const policy = fortnoxConnectionPolicy(process.env);
  const company = await fortnoxGet<{ CompanySettings?: FortnoxCompanySettingsResponse }>('/settings/company');
  const orgNumber = company.CompanySettings?.OrganizationNumber ?? null;
  const verdict = judgeFortnoxCompany(policy, orgNumber);
  if (!verdict.ok) abort(verdict.message);
  console.log(`Fortnox-bolag: ${company.CompanySettings?.Name ?? '?'} (${orgNumber}) — godkänt testbolag.`);

  // Underlaget: cachen (prods artiklar) och testbolagets levande register.
  const rows: Parameters<typeof planArticleCopy>[0] = [];
  for (let from = 0; ; from += CACHE_PAGE) {
    const { data, error } = await getSupabaseAdmin()
      .from('fortnox_articles_cache')
      .select('article_number, description, note, sales_price, purchase_price, unit, article_type, active, raw')
      .order('article_number')
      .range(from, from + CACHE_PAGE - 1);
    if (error) abort(`Kunde inte läsa artikelcachen: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < CACHE_PAGE) break;
  }

  const present = new Set<string>();
  for (let page = 1, pages = 1; page <= pages; page++) {
    const res = await fortnoxGet<{
      Articles?: { ArticleNumber: string }[];
      MetaInformation?: { '@TotalPages'?: number };
    }>('/articles', { limit: '500', page: String(page) });
    for (const a of res.Articles ?? []) present.add(a.ArticleNumber);
    pages = res.MetaInformation?.['@TotalPages'] ?? 1;
  }
  const units = (await listFortnoxUnits()).map((u) => u.code);
  const priceList = pickDefaultPriceList(await listFortnoxPriceLists());

  const plan = planArticleCopy(rows, present, units, priceList);

  console.log(`\nI cachen: ${rows.length} artiklar. Finns redan i testbolaget: ${plan.alreadyPresent}.`);
  console.log(`Att skapa: ${plan.items.length} artiklar (varav ${plan.items.filter((i) => !i.input.Active).length} inaktiva, ${plan.items.filter((i) => i.housework).length} husarbete).`);
  console.log(`Enheter att skapa: ${plan.unitsToCreate.length ? plan.unitsToCreate.join(', ') : '(inga)'}`);
  if (Object.keys(plan.unitAliases).length) {
    console.log(`Enheter som finns med annan versal och används som de är: ${Object.entries(plan.unitAliases).map(([a, b]) => `${a} → ${b}`).join(', ')}`);
  }
  console.log(`Pris sätts på prislista: ${priceList ?? '(ingen prislista i testbolaget — inga priser)'}`);
  console.log(`Artikeltyp okänd i cachen (skapas som STOCK, Fortnox standard): ${plan.items.filter((i) => !i.typeKnown).length}`);

  if (!apply) {
    console.log('\nTorrkörning — ingenting skrevs. Kör igen med --apply för att skapa.\n');
    return;
  }

  const failedUnits = new Set<string>();
  for (const code of plan.unitsToCreate) {
    try {
      // Fortnox kräver en beskrivning ("Text måste vara angivet"). Prods texter finns inte i cachen, så
      // koden får stå som text — byt den i testbolaget vid behov. Gissa inte vad en förkortning betyder.
      await createFortnoxUnit(code, code);
      console.log(`  enhet skapad: ${code}`);
    } catch (e) {
      failedUnits.add(code);
      console.warn(`  enhet ${code} misslyckades: ${errorText(e)}`);
    }
  }

  const failures: { articleNumber: string; reason: string }[] = [];
  let created = 0;
  for (const [index, item] of plan.items.entries()) {
    // En artikel vars enhet inte gick att skapa avvisas ändå — spara anropen och säg varför.
    if (item.input.Unit && failedUnits.has(item.input.Unit)) {
      failures.push({ articleNumber: item.articleNumber, reason: `enheten ${item.input.Unit} kunde inte skapas` });
      continue;
    }
    try {
      await createFortnoxArticle(item.input, item.prices);
      if (item.housework) {
        await fortnoxPut(`/articles/${encodeURIComponent(item.articleNumber)}`, { Article: { Housework: true } });
      }
      created++;
    } catch (e) {
      // createFortnoxArticle skapar artikeln FÖRST och sätter sedan pris och cache. Finns artikeln nu
      // trots felet hoppar nästa körning över den — säg det, så att priset/flaggan inte glöms.
      let exists = false;
      try {
        await fortnoxGet(`/articles/${encodeURIComponent(item.articleNumber)}`);
        exists = true;
      } catch (probe) {
        if (!(probe instanceof FortnoxApiError && probe.status === 404)) throw probe;
      }
      failures.push({
        articleNumber: item.articleNumber,
        reason: exists ? `SKAPAD men ofullständig (pris/husarbete/cache) — rätta i Fortnox: ${errorText(e)}` : errorText(e),
      });
    }
    if ((index + 1) % 25 === 0) console.log(`  ${index + 1}/${plan.items.length}…`);
    await fortnoxSleep(PAUSE_BETWEEN_ARTICLES_MS);
  }

  console.log(`\nSkapade: ${created}. Misslyckades: ${failures.length}.`);
  const byReason = new Map<string, string[]>();
  for (const f of failures) {
    // Gruppera "Artikelnummer "X" används redan." på orsaken, inte på numret.
    const key = f.reason.replace(/"[^"]*"/g, '"…"');
    byReason.set(key, [...(byReason.get(key) ?? []), f.articleNumber]);
  }
  for (const [reason, numbers] of byReason) {
    console.log(`  ${numbers.length} st — ${reason}: ${numbers.join(', ')}`);
  }
  if (failures.length || failedUnits.size) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
