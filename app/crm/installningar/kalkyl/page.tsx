import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  getCalcSettings,
  listCostArticlePrices,
  listMaterialCostArticles,
  listProductivityRates,
  mapLaborCostPerHour,
  mapMaterialCostArticleViews,
  mapProductivityRates,
  mapTeamSize,
  type CalcSettingsRow,
  type MaterialCostArticleRow,
  type ProductivityRateRow,
} from '@/lib/domains/crm/calcSettings';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';
import { CONSTRUCTION_SLUGS, constructionLabel } from '@/lib/domains/crm/constructions';
import CalcSettingsClient from './CalcSettingsClient';

// Kalkylinställningarna: timkostnaden och materialens kostnadsartiklar. Underlaget till
// efterkalkylen på arbetsordern.
//
// Admin-only, samma spärr som systersidorna artiklar och enheter. Rutterna gatar om på crm.admin —
// den här raden gör bara att sidan inte ens öppnas.

export const dynamic = 'force-dynamic';

export default async function KalkylPage() {
  const profile = await getUserProfile();
  if (profile?.role !== 'admin') redirect('/crm');

  // Samma admin-klient som systersidorna. Artikelcachens SELECT-policy är rollbaserad, och de två
  // inställningstabellerna läses ändå bäst genom samma klient som skrev dem.
  const supabase = getSupabaseAdmin();
  const [settingsResult, mappingResult, ratesResult] = await Promise.all([
    getCalcSettings(supabase),
    listMaterialCostArticles(supabase),
    listProductivityRates(supabase),
  ]);

  // Migreringen kan sakna körning. Sidan ska då säga det, inte krascha — klienten renderar
  // beskedet ur `tablesMissing`.
  const tablesMissing = Boolean(settingsResult.error || mappingResult.error);
  // Produktivitetstabellen kom senare (20260829) och kan saknas även när de andra finns. Egen
  // flagga, så rutnätet kan säga sitt utan att dölja resten av sidan.
  const productivityMissing = Boolean(ratesResult.error);
  const mappings = (mappingResult.data || []) as MaterialCostArticleRow[];
  const articleNumbers = [...new Set(mappings.map((row) => row.article_number))];
  const priceResult = articleNumbers.length > 0
    ? await listCostArticlePrices(supabase, articleNumbers)
    : { data: [], error: null };

  return (
    <CalcSettingsClient
      tablesMissing={tablesMissing}
      productivityMissing={productivityMissing}
      initialLaborCostPerHour={mapLaborCostPerHour(settingsResult.data as CalcSettingsRow | null)}
      initialTeamSize={mapTeamSize(settingsResult.data as CalcSettingsRow | null)}
      initialMaterials={mapMaterialCostArticleViews(mappings, (priceResult.data || []) as any[])}
      initialRates={mapProductivityRates(ratesResult.data as ProductivityRateRow[] | null)}
      knownMaterials={MATERIAL_SHORTS}
      constructions={CONSTRUCTION_SLUGS.map((slug) => ({ slug, label: constructionLabel(slug) }))}
    />
  );
}
