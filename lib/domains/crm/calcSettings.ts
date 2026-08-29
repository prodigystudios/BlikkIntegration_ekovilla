import type { SupabaseClient } from '@supabase/supabase-js';
import { parseDecimal } from '@/lib/shared/number';
import type { MaterialCostArticle } from '@/lib/domains/crm/afterCalculation';

// Efterkalkylens två inställningar — läs- och skrivvägen.
//
// Tabellerna kommer från supabase/sql/20260828_crm_cost_settings.sql:
//
//   crm_calc_settings            singleton, timkostnaden i kr per MAN-timme
//   crm_material_cost_articles   material (kortkod) -> kostnadsartikel i Fortnox
//
// Modulen gör bara I/O och mappning. Själva räkningen bor i afterCalculation.ts och är ren.
//
// ⚠️ KOSTNADSARTIKELN ÄR INTE FÖRSÄLJNINGSARTIKELN. Offertraden bär den artikel vi säljer på, och
// den bär (belagt 2026-08-28) fel inköpspris. Kostnadsartiklarna är egna nummer, prissatta PER
// SÄCK — det är vad som gör efterkalkylen exakt, eftersom fältets rapport redan är i säckar.

export const CALC_SETTINGS_SINGLETON_ID = true;

export type CalcSettingsRow = {
  labor_cost_per_hour: number | string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type MaterialCostArticleRow = {
  material: string;
  article_number: string;
  updated_at: string | null;
};

/** En kostnadsartikel som inställningssidan visar den: mappningen PLUS vad Fortnox säger om den. */
export type MaterialCostArticleView = {
  material: string;
  article_number: string;
  /** Artikelns namn i Fortnox, eller null när numret inte finns i cachen. */
  description: string | null;
  /** Inköpspris per säck, eller null när artikeln saknas eller står utan pris. */
  purchase_price: number | null;
  /** Fortnox enhet. Visas som upplysning — efterkalkylen ANTAR säck och läser inte fältet. */
  unit: string | null;
  /** false = artikeln är avaktiverad i Fortnox. Priset används ändå; flaggan är en varning. */
  active: boolean;
  /** true när artikelnumret inte gick att hitta i cachen alls. */
  missing: boolean;
};

// ── Läsning ──────────────────────────────────────────────────────────────────

export async function getCalcSettings(supabase: SupabaseClient) {
  return supabase
    .from('crm_calc_settings')
    .select('labor_cost_per_hour, updated_at, updated_by')
    .eq('id', CALC_SETTINGS_SINGLETON_ID)
    .maybeSingle();
}

export async function listMaterialCostArticles(supabase: SupabaseClient) {
  return supabase
    .from('crm_material_cost_articles')
    .select('material, article_number, updated_at')
    .order('material', { ascending: true });
}

/**
 * Artikelcachens rader för en uppsättning artikelnummer.
 *
 * ⚠️ `active` filtreras INTE bort. En kostnadsartikel som avaktiverats i Fortnox har fortfarande ett
 * inköpspris, och att tyst tappa priset hade fått efterkalkylen att säga "inköpspris saknas" på ett
 * jobb där kostnaden är fullt känd. Avaktiveringen rapporteras i stället som en flagga.
 */
export async function listCostArticlePrices(supabase: SupabaseClient, articleNumbers: string[]) {
  return supabase
    .from('fortnox_articles_cache')
    .select('article_number, description, purchase_price, unit, active')
    .in('article_number', articleNumbers);
}

// ── Mappning (ren) ───────────────────────────────────────────────────────────

/**
 * Timkostnaden som ett tal, eller null när inställningen saknas.
 *
 * ⚠️ numeric kommer tillbaka som STRÄNG ur PostgREST. Skickas den vidare orörd blir arbetskostnaden
 * en strängkonkatenering någonstans längre fram.
 */
export function mapLaborCostPerHour(row: CalcSettingsRow | null | undefined): number | null {
  if (!row || row.labor_cost_per_hour == null) return null;
  const value = parseDecimal(row.labor_cost_per_hour, 0);
  return value > 0 ? value : null;
}

type CachedPriceRow = {
  article_number: string;
  description?: string | null;
  purchase_price?: number | string | null;
  unit?: string | null;
  active?: boolean | null;
};

/** Mappningarna + artikelcachen → det inställningssidan visar. */
export function mapMaterialCostArticleViews(
  mappings: MaterialCostArticleRow[],
  priceRows: CachedPriceRow[],
): MaterialCostArticleView[] {
  const byNumber = new Map(priceRows.map((row) => [row.article_number, row]));
  return mappings.map((mapping) => {
    const article = byNumber.get(mapping.article_number);
    const price = article?.purchase_price == null ? null : parseDecimal(article.purchase_price, 0);
    return {
      material: mapping.material,
      article_number: mapping.article_number,
      description: article?.description ?? null,
      purchase_price: price != null && price > 0 ? price : null,
      unit: article?.unit ?? null,
      active: article?.active !== false,
      missing: !article,
    };
  });
}

/** Mappningarna + artikelcachen → det efterkalkylen räknar på. */
export function mapMaterialCostArticles(
  mappings: MaterialCostArticleRow[],
  priceRows: CachedPriceRow[],
): MaterialCostArticle[] {
  return mapMaterialCostArticleViews(mappings, priceRows).map((view) => ({
    material: view.material,
    articleNumber: view.article_number,
    purchasePrice: view.purchase_price,
  }));
}

// ── Skrivning ────────────────────────────────────────────────────────────────

export async function upsertCalcSettings(
  supabase: SupabaseClient,
  input: { laborCostPerHour: number; userId: string },
) {
  return supabase
    .from('crm_calc_settings')
    .upsert(
      {
        id: CALC_SETTINGS_SINGLETON_ID,
        labor_cost_per_hour: input.laborCostPerHour,
        updated_at: new Date().toISOString(),
        updated_by: input.userId,
      },
      { onConflict: 'id' },
    )
    .select('labor_cost_per_hour, updated_at, updated_by')
    .single();
}

export async function upsertMaterialCostArticle(
  supabase: SupabaseClient,
  input: { material: string; articleNumber: string; userId: string },
) {
  return supabase
    .from('crm_material_cost_articles')
    .upsert(
      {
        material: input.material,
        article_number: input.articleNumber,
        updated_at: new Date().toISOString(),
        updated_by: input.userId,
      },
      { onConflict: 'material' },
    )
    .select('material, article_number, updated_at')
    .single();
}

export async function deleteMaterialCostArticle(supabase: SupabaseClient, material: string) {
  return supabase.from('crm_material_cost_articles').delete().eq('material', material).select('material');
}
