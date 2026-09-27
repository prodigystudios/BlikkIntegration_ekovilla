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
 * 🧨 Skriptet skriver i det Fortnox-bolag som den lokala databasen är kopplad till. Spärrarna mot fel
 * databas och fel bolag står i scripts/fortnox/testCompany.ts.
 *
 * Skapar listan om den saknas och sätter grundpriset (FromQuantity 0) för varje artikel vars pris
 * saknas eller skiljer sig. Rör inga andra listor, inga mängdrabatter och inga artiklar. Artiklar som
 * saknas i testbolaget listas — kör copy-articles-to-test-company.ts först. Exitkoden är 1 om något
 * misslyckades eller om listan blir ofullständig.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { abort, errorText, fortnoxReason, assertLocalFortnoxTestCompany } from './testCompany';

// Samma filer och ordning som `next dev`: .env.development.local vinner över .env.local.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

// Ett pris kostar två anrop (setArticlePrice läser först). Fortnox tillåter ~4 anrop/s.
const PAUSE_BETWEEN_PRICES_MS = 600;

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sourcePath = argValue('--source');
  if (!sourcePath) abort('Ange portalens lista: --source <portalrepot>/lib/data/mock/seed.ts');

  const { fortnoxSleep, FortnoxApiError } = await import('@/lib/domains/fortnox/client');
  const { listFortnoxPriceLists } = await import('@/lib/domains/fortnox/customers');
  const { setArticlePrice, listFortnoxArticleNumbers } = await import('@/lib/domains/fortnox/articles');
  const { listFortnoxPriceListPrices, createFortnoxPriceList, RESELLER_PRICE_LIST_CODE, RESELLER_PRICE_LIST_DESCRIPTION } =
    await import('@/lib/domains/fortnox/priceLists');
  const { parsePortalPricelist, planPriceListCopy } = await import('@/lib/domains/fortnox/priceListCopy');

  // Källan först: ett fel i sökvägen eller i portalens form ska stoppa skriptet innan Fortnox anropas.
  // Filen har bara typimporter, så den går att importera direkt.
  let source: ReturnType<typeof parsePortalPricelist>;
  try {
    const sourceModule = (await import(pathToFileURL(resolve(sourcePath)).href)) as { PRICELIST?: unknown };
    source = parsePortalPricelist(sourceModule.PRICELIST);
  } catch (e) {
    // Hela meddelandet: parsePortalPricelist räknar upp det som inte stämmer.
    abort(`Källan ${sourcePath} gick inte att läsa: ${e instanceof Error ? e.message : String(e)}`);
  }

  await assertLocalFortnoxTestCompany();
  console.log(`Källa: ${sourcePath} — lista giltig från ${source.validFrom}, ${source.prices.length} artiklar.`);

  // Testbolagets läge: finns listan, vilka artiklar finns, vilka priser står redan på listan.
  const listExists = (await listFortnoxPriceLists()).some((l) => l.code === RESELLER_PRICE_LIST_CODE);
  const present = await listFortnoxArticleNumbers();
  let existing: Awaited<ReturnType<typeof listFortnoxPriceListPrices>> = [];
  if (listExists) {
    try {
      existing = await listFortnoxPriceListPrices(RESELLER_PRICE_LIST_CODE);
    } catch (e) {
      // Hur Fortnox svarar för en befintlig lista UTAN priser är inte provat. Här är 404 ofarligt —
      // listan finns, så inga priser betyder att allt ska skapas. Läsaren i biblioteket kastar med flit.
      if (!(e instanceof FortnoxApiError && e.status === 404)) throw e;
      console.log(`Lista ${RESELLER_PRICE_LIST_CODE} gav 404 på prisläsningen — räknas som tom.`);
    }
  }

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
  if (plan.notInSource.length) {
    console.log(`På listan men inte i källan (rörs inte): ${plan.notInSource.join(', ')}`);
  }
  const incomplete = plan.missingArticles.length + plan.rejected.length;
  if (incomplete) {
    console.log(`⚠️ Listan blir ofullständig: ${incomplete} av källans artiklar får inget pris.`);
    process.exitCode = 1;
  }

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
      failures.push({ articleNumber: item.articleNumber, reason: fortnoxReason(e) });
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
