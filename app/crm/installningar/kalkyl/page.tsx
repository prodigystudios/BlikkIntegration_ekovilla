import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  getCalcSettings,
  listCostArticlePrices,
  listMaterialCostArticles,
  mapLaborCostPerHour,
  mapMaterialCostArticleViews,
  type CalcSettingsRow,
  type MaterialCostArticleRow,
} from '@/lib/domains/crm/calcSettings';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';
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
  const [settingsResult, mappingResult] = await Promise.all([
    getCalcSettings(supabase),
    listMaterialCostArticles(supabase),
  ]);

  // Migreringen kan sakna körning. Sidan ska då säga det, inte krascha — klienten renderar
  // beskedet ur `tablesMissing`.
  const tablesMissing = Boolean(settingsResult.error || mappingResult.error);
  const mappings = (mappingResult.data || []) as MaterialCostArticleRow[];
  const articleNumbers = [...new Set(mappings.map((row) => row.article_number))];
  const priceResult = articleNumbers.length > 0
    ? await listCostArticlePrices(supabase, articleNumbers)
    : { data: [], error: null };

  return (
    <CalcSettingsClient
      tablesMissing={tablesMissing}
      initialLaborCostPerHour={mapLaborCostPerHour(settingsResult.data as CalcSettingsRow | null)}
      initialMaterials={mapMaterialCostArticleViews(mappings, (priceResult.data || []) as any[])}
      knownMaterials={MATERIAL_SHORTS}
    />
  );
}
