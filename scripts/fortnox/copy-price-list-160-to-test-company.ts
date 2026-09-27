/**
 * Lägger prislista 160 (Byggvaruhandel) med priser i Fortnox TESTBOLAG, så att CRM:ets läsning och
 * publicering av återförsäljarnas prislista (RESELLER_PORTAL_CRM_PLAN.md, fas 2b) har något att läsa
 * lokalt.
 *
 *   npx -y tsx scripts/fortnox/copy-price-list-160-to-test-company.ts --source <fil>           torrkörning
 *   npx -y tsx scripts/fortnox/copy-price-list-160-to-test-company.ts --source <fil> --apply   skriver
 *
 * `<fil>` är portalrepots `lib/data/mock/seed.ts`, som exporterar `PRICELIST`: portalens handinlästa
 * kopia av prods lista 160. Prods Fortnox läses aldrig härifrån — en tokenförnyelse roterar
 * refresh-token och kopplar ur prod.
 *
 * 🧨 Skriptet skriver i det Fortnox-bolag som den lokala databasen är kopplad till. Det vägrar därför om
 *   - databasen inte är lokal (.env.development.local måste finnas — utan den pekar .env.local på PROD), eller
 *   - Fortnox svarar med ett bolag som inte står i FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS.
 * Samma spärrar som copy-articles-to-test-company.ts.
 *
 * Skapar listan om den saknas och sätter grundpriset (FromQuantity 0) för varje artikel vars pris
 * saknas eller skiljer sig. Rör inga andra listor, inga mängdrabatter och inga artiklar. Artiklar som
 * saknas i testbolaget listas — kör copy-articles-to-test-company.ts först. Exitkoden är 1 om något
 * misslyckades.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';

// Samma filer och ordning som `next dev`: .env.development.local vinner över .env.local.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

// Ett pris kostar två anrop (setArticlePrice läser först). Fortnox tillåter ~4 anrop/s.
const PAUSE_BETWEEN_PRICES_MS = 600;

function abort(message: string): never {
  console.error(`\n⛔ ${message}\n`);
  process.exit(1);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 200) : String(e);
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sourcePath = argValue('--source');
  if (!sourcePath) abort('Ange portalens lista: --source <portalrepot>/lib/data/mock/seed.ts');

  // Importerna först NU: modulerna ska se miljön som laddades ovan.
  const { fortnoxConnectionPolicy, judgeFortnoxCompany, isLocalSupabaseUrl } = await import(
    '@/lib/domains/fortnox/connectionGuard'
  );
  const { fortnoxGet, fortnoxSleep } = await import('@/lib/domains/fortnox/client');
  const { listFortnoxPriceLists } = await import('@/lib/domains/fortnox/customers');
  const { setArticlePrice } = await import('@/lib/domains/fortnox/articles');
  const { listFortnoxPriceListPrices, createFortnoxPriceList } = await import('@/lib/domains/fortnox/priceLists');
  const { parsePortalPricelist, planPriceListCopy, RESELLER_PRICE_LIST_CODE, RESELLER_PRICE_LIST_DESCRIPTION } =
    await import('@/lib/domains/fortnox/priceListCopy');

  // Spärr 1: databasen. Tokens läses och skrivs här — den får aldrig vara prods.
  const dbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!isLocalSupabaseUrl(dbUrl)) abort(`Databasen är inte lokal (${dbUrl ?? 'ingen URL'}). Kör bara mot den lokala stacken.`);

  // Spärr 2: bolaget.
  const company = await fortnoxGet<{ CompanySettings?: { Name?: string; OrganizationNumber?: string } }>(
    '/settings/company',
  );
  const orgNumber = company.CompanySettings?.OrganizationNumber ?? null;
  const verdict = judgeFortnoxCompany(fortnoxConnectionPolicy(process.env), orgNumber);
  if (!verdict.ok) abort(verdict.message);
  console.log(`Fortnox-bolag: ${company.CompanySettings?.Name ?? '?'} (${orgNumber}) — godkänt testbolag.`);

  // Källan: portalens PRICELIST. Filen har bara typimporter, så den går att importera direkt.
  const sourceModule = (await import(pathToFileURL(resolve(sourcePath)).href)) as { PRICELIST?: unknown };
  let source: ReturnType<typeof parsePortalPricelist>;
  try {
    source = parsePortalPricelist(sourceModule.PRICELIST);
  } catch (e) {
    abort(errorText(e));
  }
  console.log(`Källa: ${sourcePath} — lista giltig från ${source.validFrom}, ${source.prices.length} artiklar.`);

  // Testbolagets läge: finns listan, vilka artiklar finns, vilka priser står redan på listan.
  const listExists = (await listFortnoxPriceLists()).some((l) => l.code === RESELLER_PRICE_LIST_CODE);
  const present = new Set<string>();
  for (let page = 1, pages = 1; page <= pages; page++) {
    const res = await fortnoxGet<{
      Articles?: { ArticleNumber: string }[];
      MetaInformation?: { '@TotalPages'?: number };
    }>('/articles', { limit: '500', page: String(page) });
    for (const a of res.Articles ?? []) present.add(a.ArticleNumber);
    pages = res.MetaInformation?.['@TotalPages'] ?? 1;
  }
  const existing = listExists ? await listFortnoxPriceListPrices(RESELLER_PRICE_LIST_CODE) : [];

  const plan = planPriceListCopy(source.prices, present, existing);

  console.log(
    `\nPrislista ${RESELLER_PRICE_LIST_CODE}: ${listExists ? 'finns redan' : `saknas — skapas som "${RESELLER_PRICE_LIST_DESCRIPTION}"`}.`,
  );
  console.log(`Priser att skapa: ${plan.toCreate.length}. Att ändra: ${plan.toUpdate.length}. Stämmer redan: ${plan.unchanged}.`);
  for (const u of plan.toUpdate) console.log(`  ändras: ${u.articleNumber} ${u.current} → ${u.price}`);
  if (plan.missingArticles.length) {
    console.log(`Saknas i testbolaget (inget pris sätts): ${plan.missingArticles.join(', ')}`);
  }
  for (const r of plan.rejected) console.log(`  hoppas över: ${r.articleNumber} — ${r.reason}`);

  if (!apply) {
    console.log('\nTorrkörning — ingenting skrevs. Kör igen med --apply för att skriva.\n');
    return;
  }

  if (!listExists) {
    try {
      await createFortnoxPriceList(RESELLER_PRICE_LIST_CODE, RESELLER_PRICE_LIST_DESCRIPTION);
      console.log(`  prislista ${RESELLER_PRICE_LIST_CODE} skapad`);
    } catch (e) {
      abort(`Prislistan kunde inte skapas: ${errorText(e)}`);
    }
  }

  const failures: { articleNumber: string; reason: string }[] = [];
  let written = 0;
  for (const item of [...plan.toCreate, ...plan.toUpdate]) {
    try {
      await setArticlePrice(item.articleNumber, RESELLER_PRICE_LIST_CODE, item.price);
      written++;
    } catch (e) {
      failures.push({ articleNumber: item.articleNumber, reason: errorText(e) });
    }
    await fortnoxSleep(PAUSE_BETWEEN_PRICES_MS);
  }

  console.log(`\nSatta priser: ${written}. Misslyckades: ${failures.length}.`);
  for (const f of failures) console.log(`  ${f.articleNumber}: ${f.reason}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
