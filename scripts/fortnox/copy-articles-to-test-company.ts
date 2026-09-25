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
 * först. Varje skapad artikel speglas tillbaka in i den lokala cachen (createFortnoxArticle gör det).
 */
import { loadEnvConfig } from '@next/env';

// Samma filer och ordning som `next dev`: .env.development.local vinner över .env.local.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '0.0.0.0', '[::1]'];

function abort(message: string): never {
  console.error(`\n⛔ ${message}\n`);
  process.exit(1);
}

async function main() {
  const apply = process.argv.includes('--apply');

  // Spärr 1: databasen. Tokens och cache läses och skrivs här — den får aldrig vara prods.
  const dbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  let dbHost = '';
  try {
    dbHost = new URL(dbUrl).hostname;
  } catch {
    abort('Ingen giltig Supabase-URL i miljön.');
  }
  if (!LOCAL_HOSTS.includes(dbHost)) abort(`Databasen är inte lokal (${dbHost}). Kör bara mot den lokala stacken.`);

  // Importerna först NU: modulerna ska se miljön som laddades ovan.
  const { fortnoxConnectionPolicy, judgeFortnoxCompany } = await import('@/lib/domains/fortnox/connectionGuard');
  const { fortnoxGet, friendlyFortnoxMessage } = await import('@/lib/domains/fortnox/client');
  const { listFortnoxUnits, createFortnoxUnit } = await import('@/lib/domains/fortnox/units');
  const { listFortnoxPriceLists } = await import('@/lib/domains/fortnox/customers');
  const { createFortnoxArticle } = await import('@/lib/domains/fortnox/articles');
  const { planArticleCopy, pickDefaultPriceList } = await import('@/lib/domains/fortnox/articleCopy');
  const { getSupabaseAdmin } = await import('@/lib/supabase/server');

  // Spärr 2: bolaget. Fråga Fortnox vilket bolag kopplingen gäller.
  const policy = fortnoxConnectionPolicy(process.env);
  if (policy.mode !== 'allowlist') abort('Miljön räknas som produktion — skriptet körs bara lokalt.');
  const company = await fortnoxGet<{ CompanySettings?: { Name?: string | null; OrganizationNumber?: string | null } }>(
    '/settings/company',
  );
  const orgNumber = company.CompanySettings?.OrganizationNumber ?? null;
  const verdict = judgeFortnoxCompany(policy, orgNumber);
  if (!verdict.ok) abort(verdict.message);
  console.log(`Fortnox-bolag: ${company.CompanySettings?.Name ?? '?'} (${orgNumber}) — godkänt testbolag.`);

  // Underlaget: cachen (prods artiklar) och testbolagets levande register.
  const { data: rows, error } = await getSupabaseAdmin()
    .from('fortnox_articles_cache')
    .select('article_number, description, note, sales_price, purchase_price, unit, article_type, active, raw');
  if (error) abort(`Kunde inte läsa artikelcachen: ${error.message}`);

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

  const plan = planArticleCopy(rows ?? [], present, units, priceList);
  const unknownType = plan.items.filter((i) => !i.typeKnown).length;

  console.log(`\nI cachen: ${rows?.length ?? 0} artiklar. Finns redan i testbolaget: ${plan.alreadyPresent}.`);
  console.log(`Att skapa: ${plan.items.length} artiklar (varav ${plan.items.filter((i) => !i.input.Active).length} inaktiva).`);
  console.log(`Enheter att skapa: ${plan.unitsToCreate.length ? plan.unitsToCreate.join(', ') : '(inga)'}`);
  if (Object.keys(plan.unitAliases).length) {
    console.log(`Enheter som finns med annan versal och används som de är: ${Object.entries(plan.unitAliases).map(([a, b]) => `${a} → ${b}`).join(', ')}`);
  }
  console.log(`Pris sätts på prislista: ${priceList ?? '(ingen prislista i testbolaget — inga priser)'}`);
  console.log(`Artikeltyp okänd i cachen (skapas som STOCK, Fortnox standard): ${unknownType}`);

  if (!apply) {
    console.log('\nTorrkörning — ingenting skrevs. Kör igen med --apply för att skapa.\n');
    return;
  }

  for (const code of plan.unitsToCreate) {
    try {
      // Fortnox kräver en beskrivning ("Text måste vara angivet"). Prods texter finns inte i cachen, så
      // koden får stå som text — byt den i testbolaget vid behov. Gissa inte vad en förkortning betyder.
      await createFortnoxUnit(code, code);
      console.log(`  enhet skapad: ${code}`);
    } catch (e) {
      console.warn(`  enhet ${code} misslyckades: ${friendlyFortnoxMessage(e)}`);
    }
  }

  const failures: { articleNumber: string; reason: string }[] = [];
  let created = 0;
  for (const [index, item] of plan.items.entries()) {
    try {
      await createFortnoxArticle(item.input, item.prices);
      created++;
    } catch (e) {
      failures.push({ articleNumber: item.articleNumber, reason: friendlyFortnoxMessage(e) });
    }
    if ((index + 1) % 25 === 0) console.log(`  ${index + 1}/${plan.items.length}…`);
  }

  console.log(`\nSkapade: ${created}. Misslyckades: ${failures.length}.`);
  const byReason = new Map<string, string[]>();
  for (const f of failures) byReason.set(f.reason, [...(byReason.get(f.reason) ?? []), f.articleNumber]);
  for (const [reason, numbers] of byReason) {
    console.log(`  ${numbers.length} st — ${reason}: ${numbers.slice(0, 15).join(', ')}${numbers.length > 15 ? ' …' : ''}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
