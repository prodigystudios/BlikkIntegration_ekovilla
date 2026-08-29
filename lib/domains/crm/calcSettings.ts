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
  /** Antal personer i laget. Produktivitetstalen är per team, timkostnaden per person. */
  team_size?: number | string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type ProductivityRateRow = {
  construction: string;
  material: string;
  m3_per_hour: number | string;
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

/**
 * Kalkylinställningarna.
 *
 * ⚠️ `select('*')` ÄR AVSIKTLIGT, inte slarv. `team_size` kom i en senare migrering (20260829) än
 * tabellen själv (20260828), och en namngiven kolumnlista hade gjort koden BEROENDE av att
 * migreringen körts först: PostgREST svarar med ett fel på en okänd kolumn, felet bubblar genom
 * computeAfterCalculations, och EFTERKALKYLEN PÅ VARJE ARBETSORDER hade slutat fungera i drift
 * tills någon körde SQL:en. Verifierat lokalt 2026-08-29 — den kedjan är inte teoretisk.
 *
 * Med `*` faller en saknad kolumn i stället tillbaka på `mapTeamSize`s default. Tabellen är en rad
 * med fyra fält, så bredden kostar ingenting.
 */
export async function getCalcSettings(supabase: SupabaseClient) {
  return supabase
    .from('crm_calc_settings')
    .select('*')
    .eq('id', CALC_SETTINGS_SINGLETON_ID)
    .maybeSingle();
}

/**
 * Produktivitetstalen, m³ per timme och TEAM.
 *
 * En saknad rad betyder INGEN UPPSKATTNING, inte noll — offerten ska säga "produktivitet saknas för
 * Vägg × PAROC" i stället för att tidsätta momentet till ingenting.
 */
export async function listProductivityRates(supabase: SupabaseClient) {
  return supabase
    .from('crm_productivity_rates')
    .select('construction, material, m3_per_hour')
    .order('construction', { ascending: true });
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

/**
 * Teamstorleken, med 2 som fallback.
 *
 * ⚠️ Fallbacken är modellens antagande (1 300 kr/h = 2 × 650) och databasens default. Att låta den
 * bli 1 vid en saknad rad hade HALVERAT varje uppskattad arbetskostnad — tyst, och åt det
 * optimistiska hållet.
 */
export function mapTeamSize(row: CalcSettingsRow | null | undefined): number {
  const value = parseDecimal(row?.team_size ?? null, 0);
  return value >= 1 ? Math.round(value) : 2;
}

/** Rå rad → förkalkylens form. numeric kommer som STRÄNG ur PostgREST. */
export function mapProductivityRates(rows: ProductivityRateRow[] | null | undefined) {
  return (rows ?? []).map((row) => ({
    construction: row.construction,
    material: row.material,
    m3PerHour: parseDecimal(row.m3_per_hour, 0),
  }));
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

/**
 * Sparar timkostnaden och teamstorleken.
 *
 * ⚠️ SKRIVNINGEN MÅSTE OCKSÅ TÅLA ATT `team_size` INTE FINNS. Läsvägen härdades med `select('*')`,
 * men en skrivning som nämner en okänd kolumn avvisas av PostgREST (PGRST204) — och då hade
 * admin inte kunnat spara ens TIMKOSTNADEN i fönstret mellan deploy och migrering, alltså ett
 * befintligt fungerande fält som slutar fungera. Faller skrivningen på just den kolumnen görs ett
 * andra försök utan den; teamstorleken hamnar då i databasen när migreringen körts.
 */
export async function upsertCalcSettings(
  supabase: SupabaseClient,
  input: { laborCostPerHour: number; teamSize: number; userId: string },
) {
  const base = {
    id: CALC_SETTINGS_SINGLETON_ID,
    labor_cost_per_hour: input.laborCostPerHour,
    updated_at: new Date().toISOString(),
    updated_by: input.userId,
  };

  const withTeam = await supabase
    .from('crm_calc_settings')
    .upsert({ ...base, team_size: input.teamSize }, { onConflict: 'id' })
    .select('*')
    .single();

  // ⚠️ SNÄVT VILLKOR. Ett andra försök ska bara göras när felet är just den saknade kolumnen —
  // PGRST204 med kolumnnamnet i texten. Ett bredare villkor ("meddelandet nämner team_size") hade
  // svalt riktiga fel och tyst sparat halva ändringen.
  const missingColumn =
    withTeam.error?.code === 'PGRST204' && /team_size/.test(withTeam.error.message ?? '');
  if (!missingColumn) return { ...withTeam, teamSizeSaved: true as const };

  const retry = await supabase.from('crm_calc_settings').upsert(base, { onConflict: 'id' }).select('*').single();
  // ⚠️ ANROPAREN MÅSTE FÅ VETA. Utan flaggan sa ytan "Timkostnaden sparad" och visade kvar det
  // inskrivna lagantalet — medan databasen inte fått det. Ett tyst halvsparat värde är värre än
  // ett fel, för nästa omladdning motsäger det man just såg.
  return { ...retry, teamSizeSaved: false as const };
}

/**
 * Sätter eller tar bort ett produktivitetstal.
 *
 * ⚠️ Att TÖMMA en ruta är en DELETE, inte en nolla. `m3_per_hour > 0` i databasen skulle avvisa
 * nollan ändå, men skillnaden är begreppslig: raden ska försvinna så att offerten säger "saknas"
 * i stället för att räkna med en takt på noll och dela med den.
 */
export async function upsertProductivityRate(
  supabase: SupabaseClient,
  input: { construction: string; material: string; m3PerHour: number; userId: string },
) {
  return supabase
    .from('crm_productivity_rates')
    .upsert(
      {
        construction: input.construction,
        material: input.material,
        m3_per_hour: input.m3PerHour,
        updated_at: new Date().toISOString(),
        updated_by: input.userId,
      },
      { onConflict: 'construction,material' },
    )
    .select('construction, material, m3_per_hour')
    .single();
}

export async function deleteProductivityRate(supabase: SupabaseClient, construction: string, material: string) {
  return supabase
    .from('crm_productivity_rates')
    .delete()
    .eq('construction', construction)
    .eq('material', material)
    .select('construction');
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
