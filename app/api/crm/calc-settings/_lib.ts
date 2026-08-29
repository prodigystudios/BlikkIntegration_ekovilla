import { z } from 'zod';
export { ok, routeError, validationError, requireCrmUser, requireCrmAdmin } from '../_shared';

// Efterkalkylens inställningar. Två skrivvägar, båda små och båda admin-gatade i sina rutter.

/**
 * Timkostnaden i kronor per MAN-timme.
 *
 * ⚠️ Taket är inte kosmetik. Satsen multipliceras med varje rapporterad timme på jobbet, så en
 * felskriven nolla (6500 i stället för 650) gör varje TB2 tiofalt fel utan att något ser trasigt
 * ut — talet är fortfarande ett rimligt tal. 10 000 kr/h är långt över allt verkligt och fångar
 * ändå fingerfelet.
 */
// ⚠️ STRIKT STÖRRE ÄN NOLL, inte min(0). Ett tomt fält blir `Number('') === 0`, vilket passerade
// min(0) och sparades — och `mapLaborCostPerHour` behandlar 0 som "inte satt", så TB2 försvann från
// VARJE arbetsorder medan sparningen sa att den lyckades. En nollsats finns inte i verkligheten;
// vägen till "ingen sats" är att aldrig ha satt någon.
export const updateCalcSettingsSchema = z.object({
  labor_cost_per_hour: z.coerce
    .number()
    .gt(0, 'Timkostnaden måste vara större än noll')
    .max(10_000, 'Timkostnaden ser orimlig ut — kontrollera siffran'),
});

/**
 * Material → kostnadsartikel.
 *
 * `material` valideras INTE mot MATERIALS. Vokabulären kan växa (ROCKWOOL är seedad men finns ännu
 * inte i materiallistan), och en mappning som inte matchar något rapporterat material är harmlös:
 * efterkalkylen hittar den bara aldrig. Att spärra här hade i stället gjort det omöjligt att
 * förbereda ett material innan det läggs till.
 */
export const upsertMaterialCostArticleSchema = z.object({
  material: z.string().trim().min(1, 'Material krävs').max(64, 'Materialkoden är för lång'),
  article_number: z.string().trim().min(1, 'Artikelnummer krävs').max(64, 'Artikelnumret är för långt'),
});

export const deleteMaterialCostArticleSchema = z.object({
  material: z.string().trim().min(1, 'Material krävs'),
});
