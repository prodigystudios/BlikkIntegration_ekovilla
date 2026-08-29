import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
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
  upsertCalcSettings,
  type CalcSettingsRow,
  type MaterialCostArticleRow,
  type ProductivityRateRow,
} from '@/lib/domains/crm/calcSettings';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';
import { CONSTRUCTION_SLUGS, constructionLabel } from '@/lib/domains/crm/constructions';
import { ok, requireCrmAdmin, requireCrmUser, routeError, updateCalcSettingsSchema, validationError } from './_lib';

// Efterkalkylens inställningar: timkostnaden och (via GET) materialens kostnadsartiklar.
//
// Läsning för alla CRM-användare, skrivning för admin — samma delning som RLS i
// 20260828_crm_cost_settings.sql. Inställningssidan är dessutom admin-only i sin page.tsx; gaten
// här är den som faktiskt håller.
//
// nodejs: artikelcachen läses med admin-klienten (service-role).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const supabase = createRouteHandlerClient({ cookies });
    const [settingsResult, mappingResult, ratesResult] = await Promise.all([
      getCalcSettings(supabase),
      listMaterialCostArticles(supabase),
      listProductivityRates(supabase),
    ]);
    // ⚠️ `ratesResult.error` fäller INTE hela svaret. Produktivitetstabellen kom i en senare
    // migrering, och en saknad tabell där ska inte ta med sig timkostnaden, kostnadsartiklarna och
    // offertens hela panel i fallet. Rutnätet har sin egen flagga på sidan.
    if (settingsResult.error || mappingResult.error) {
      return routeError(
        500,
        'crm_calc_settings_read_failed',
        'Kalkylinställningarna kunde inte läsas. Är 20260828_crm_cost_settings.sql körd?',
      );
    }

    const mappings = (mappingResult.data || []) as MaterialCostArticleRow[];
    const articleNumbers = [...new Set(mappings.map((row) => row.article_number))];
    // Artikelcachens SELECT-policy är rollbaserad (sales/admin). Uppslaget görs därför med
    // admin-klienten, precis som listCachedFortnoxArticles gör på varje annan yta — annars hade
    // beskrivningen och priset tyst uteblivit för vissa läsare och sett ut som en saknad artikel.
    const priceResult = articleNumbers.length > 0
      ? await listCostArticlePrices(getSupabaseAdmin(), articleNumbers)
      : { data: [], error: null };
    if (priceResult.error) {
      return routeError(500, 'crm_calc_settings_article_prices_failed', priceResult.error.message);
    }

    const settings = settingsResult.data as CalcSettingsRow | null;
    return ok({
      labor_cost_per_hour: mapLaborCostPerHour(settings),
      team_size: mapTeamSize(settings),
      updated_at: settings?.updated_at ?? null,
      // Rå rader: inställningssidan fyller ett rutnät och behöver dem per kombination.
      productivity_rates: mapProductivityRates(ratesResult.data as ProductivityRateRow[] | null),
      // ⚠️ SKILJ "TABELLEN FINNS INTE" FRÅN "INGA TAL IFYLLDA". Utan flaggan blev en saknad tabell
      // till en tom lista, och offertens panel sa "produktivitet saknas för Vind × EKOVILLA — fyll
      // i talen" om något ingen kan fylla i förrän migreringen körts.
      productivity_available: !ratesResult.error,
      constructions: CONSTRUCTION_SLUGS.map((slug) => ({ slug, label: constructionLabel(slug) })),
      materials: mapMaterialCostArticleViews(mappings, (priceResult.data || []) as any[]),
      // Vokabulären kommer från koden, inte från databasen — samma lista som fältets rapport
      // skriver. Skickas med så inställningssidan kan erbjuda exakt de kortkoder som kan matcha.
      known_materials: MATERIAL_SHORTS,
    });
  } catch (e: any) {
    return routeError(500, 'crm_calc_settings_unexpected', e?.message || 'Failed to read calc settings');
  }
}

export async function PUT(req: Request) {
  try {
    const crmAdmin = await requireCrmAdmin();
    if (crmAdmin.response || !crmAdmin.currentUser) return crmAdmin.response;

    const parsedBody = updateCalcSettingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return validationError(parsedBody.error);

    // Sessionsklienten med flit: RLS (crm.admin) är garantin, gaten ovan är det läsbara felet.
    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await upsertCalcSettings(supabase, {
      laborCostPerHour: parsedBody.data.labor_cost_per_hour,
      teamSize: parsedBody.data.team_size,
      userId: crmAdmin.currentUser.id,
    });
    if (error || !data) {
      return routeError(500, 'crm_calc_settings_update_failed', error?.message || 'Kunde inte spara timkostnaden.');
    }

    return ok({
      labor_cost_per_hour: mapLaborCostPerHour(data as CalcSettingsRow),
      team_size: mapTeamSize(data as CalcSettingsRow),
      updated_at: (data as CalcSettingsRow).updated_at,
    });
  } catch (e: any) {
    return routeError(500, 'crm_calc_settings_update_unexpected', e?.message || 'Failed to update calc settings');
  }
}
