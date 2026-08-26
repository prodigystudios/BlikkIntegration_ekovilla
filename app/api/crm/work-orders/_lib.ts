import { z } from 'zod';
import { quoteLineItemSchema } from '../quotes/_lib';
import { WORK_ORDER_FILE_CATEGORIES } from '@/lib/domains/crm/workOrderFiles/types';
import { CONSTRUCTION_SLUGS } from '@/lib/domains/crm/constructions';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';
export { ok, routeError, validationError, invalidUuidParam, isNoRowsError, requireCrmUser, requireCrmWriter, requirePermission, requireSignedInUser, pickProvidedFields } from '../_shared';

// Reuses the quote line-item schema so work order article edits validate identically.
export const updateWorkOrderLineItemsSchema = z.object({
  line_items: z.array(quoteLineItemSchema).default([]),
});

function normalizeOptionalText(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

// 'ready' is retired (migration 20260607 dropped it from the DB CHECK + migrated rows to
// 'scheduled'), so it's not accepted on write. It stays in the display label/class maps
// (crmTokens) only as a fallback for any un-migrated legacy row.
const workOrderStatusSchema = z.enum(['draft', 'scheduled', 'in_progress', 'completed', 'partially_invoiced', 'invoiced', 'cancelled']);

// Per-article quantities for a delfakturering (partial invoice) round: how much of each line
// item (matched by its index in line_items) to invoice now. Quantities are coerced to numbers;
// the domain validates them against each line's remaining quantity. Swedish comma input is
// normalised client-side before submit.
export const partialInvoiceSchema = z.object({
  // Raden pekas ut med sitt stabila id; `index` är reservvägen för rader utan id (och för en
  // klient som ännu inte laddat om). Minst ett av dem måste finnas, annars går raden inte att
  // adressera alls — och en delfaktura som gissar rad är precis det vi aldrig får göra.
  lines: z
    .array(z.object({
      line_id: z.string().min(1).nullish(),
      index: z.number().int().min(0).nullish(),
      quantity: z.coerce.number().min(0),
    }).refine((l) => l.line_id != null || l.index != null, 'Raden saknar både id och position'))
    .min(1, 'Ange minst en rad att fakturera'),
});
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum');

// Create a standalone work order (no originating quote). Customer is required; identity
// (name/snapshot/address) is derived from the customer card server-side.
export const createStandaloneWorkOrderSchema = z.object({
  customer_id: z.string().uuid('Välj en kund'),
  project_name: z.string().trim().min(1, 'Ordernamn krävs'),
  desired_installation_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
});

// Klockslag, inte ett timtal. Raden ligger i crm_time_entries — SAMMA tabell som löneunderlaget —
// och lönen härleder OB och övertid ur start och slut (William 2026-08-14). Ett timtal går inte att
// räkna övertid på: nio timmar säger inte om de låg 07–16 eller 14–23.
//
// Rasten anges separat och dras av på servern. Byråns exempel: 08–18 med en timmes rast är nio
// timmar, inte tio.
const clockSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Ogiltigt klockslag (TT:MM)');

export const createWorkOrderTimeEntrySchema = z.object({
  work_date: dateSchema,
  start_time: clockSchema,
  end_time: clockSchema,
  break_minutes: z.coerce.number().int().min(0).max(1439).optional().default(0),
  note: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
});

// ── Filer på ordern ─────────────────────────────────────────────────────────
//
// Uppladdningen sker i två steg: klienten ber om en signerad URL, laddar upp direkt till lagringen,
// och bekräftar sedan. Byten passerar aldrig en route handler — en ritning på 20 MB är vanlig och
// ska inte behöva rymmas i en request-kropp.
//
// Steg 1: klienten talar om vad den TÄNKER ladda upp. Allt här är påståenden — de duger för att
// avvisa uppenbart fel tidigt (innan vi ens myntar en URL), men servern litar aldrig på dem: i
// steg 2 läses filens faktiska storlek och mimetype ur lagringen.
export const workOrderFileUploadUrlSchema = z.object({
  file_name: z.string().trim().min(1, 'Filnamn krävs').max(255, 'Filnamnet är för långt'),
  content_type: z.string().trim().max(255).optional().default(''),
  size_bytes: z.coerce.number().int().min(0, 'Ogiltig filstorlek'),
});

// Steg 2: bekräfta att uppladdningen gick igenom och skapa raden.
// `storage_path` valideras mot ordern i routen (isWorkOrderFilePath) — en klient som hittar på en
// sökväg får inte kunna koppla ett Support/- eller Documents/-objekt till sin arbetsorder.
export const createWorkOrderFileSchema = z.object({
  storage_path: z.string().trim().min(1, 'Sökväg krävs'),
  file_name: z.string().trim().min(1, 'Filnamn krävs').max(255, 'Filnamnet är för långt'),
  category: z.enum(WORK_ORDER_FILE_CATEGORIES).default('other'),
  // Nekas för den som saknar crm.workorder.write — routen tvingar false, och RLS gör om samma
  // kontroll så en handskriven POST inte kan gömma en fil för besättningen.
  //
  // INTE z.coerce.boolean(): den gör Boolean(värde), och `Boolean("false") === true`. Strängen
  // "false" hade alltså DOLT filen för besättningen — raka motsatsen till vad avsändaren bad om,
  // och tyst. Bara ett riktigt booleskt värde eller de två strängarna räknas.
  is_internal: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
    .optional()
    .default(false),
});

// Delrapport av blåsta säckar från fältvyn — dörr 2 i säckrapporteringen.
//
// FLERA PLACERINGAR I EN SUBMIT. En dag går sällan åt till en enda yta, och på ett tak med dålig
// täckning slår en POST tre. Datum och notering hör till DAGEN och stämplas på varje rad; det som
// skiljer raderna är placering, antal och (vid behov) material.
//
// ⚠️ RUTTEN SKRIVER BARA `kind: 'partial'`. Finaler kommer uteslutande från egenkontrollen, som är
// jobbets fulla sanning. Skulle den här vägen kunna skriva en final vore den ett andra ställe som
// kan släcka hela jobbets delrapporter.
export const createSackReportSchema = z.object({
  report_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum'),
  note: z.preprocess(normalizeOptionalText, z.string().nullable()).optional().default(null),
  entries: z
    .array(
      z.object({
        // Obligatorisk, till skillnad från offertraden där fältet är '' tills regexen gissar rätt.
        // Delrapporten är appens FÖRSTA yta där en människa faktiskt väljer placering — hela
        // poängen är att den rapporterade sidan blir pålitlig.
        construction: z.enum(CONSTRUCTION_SLUGS),
        // Max matchar kolumnens numeric(10,2) — en databasfakta, inte en påhittad affärsregel.
        // 0 är TILLÅTET och betyder något: "vi var här, inget gick åt" är ett svar, till skillnad
        // från att inte rapportera alls.
        sacks_blown: z.coerce.number().finite().min(0).max(99999999.99),
        // Valfritt. Utan det faller depåavdraget tillbaka på materialet som härleds ur orderns
        // artikelrader — samma beteende som före säckrapporteringen.
        material: z
          .preprocess(normalizeOptionalText, z.string().nullable())
          .optional()
          .default(null)
          .refine((m) => m === null || MATERIAL_SHORTS.includes(m), 'Okänt material'),
      }),
    )
    .min(1, 'Minst en placering måste rapporteras')
    .max(CONSTRUCTION_SLUGS.length, 'Högst en rad per placering')
    // En placering per submit. Två rader för samma yta samma dag är nästan alltid ett
    // dubbeltryck, och boken är append-only — den felskrivningen går inte att ta tillbaka
    // från fältet.
    .refine(
      (entries) => new Set(entries.map((e) => e.construction)).size === entries.length,
      'Samma placering kan bara rapporteras en gång per dag',
    ),
});

// Egenkontrollens säckar — dörr 1. Skiljer sig från delrapportens schema på två punkter, båda med
// flit:
//
//   * `construction` är NULLBAR. Egenkontrollen har ingen placeringsväljare; slug:en bärs tyst med
//     från offertraden och saknas för rader installatören lagt till själv. Rätt svar är då
//     "Ospecificerad", inte ett avvisat dokument — säckarna blåstes ju.
//   * INGEN dubblettspärr på placering. Två etapprader kan mycket väl vara samma konstruktion
//     (två vindsutrymmen), och finalerna summeras ändå.
export const createFinalSackReportSchema = z.object({
  report_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum'),
  entries: z
    .array(
      z.object({
        construction: z.enum(CONSTRUCTION_SLUGS).nullable().optional().default(null),
        sacks_blown: z.coerce.number().finite().min(0).max(99999999.99),
        material: z
          .preprocess(normalizeOptionalText, z.string().nullable())
          .optional()
          .default(null)
          .refine((m) => m === null || MATERIAL_SHORTS.includes(m), 'Okänt material'),
      }),
    )
    .min(1, 'Egenkontrollen innehåller inga säckar att rapportera')
    .max(40),
});

export const createWorkOrderCommentSchema = z.object({
  body: z.string().trim().min(1, 'Kommentar krävs'),
  // Ids of users @-mentioned in the body (client-supplied; validated server-side before notifying).
  mentioned_user_ids: z.array(z.string().uuid()).optional().default([]),
});

export const listCrmWorkOrdersQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: workOrderStatusSchema.optional(),
  // Board composite filter (status group). Server-side so the paginated list is correct.
  filter: z.enum(['all', 'draft', 'scheduled', 'active', 'completed', 'invoiced']).optional(),
  // Assignee scope — comma-separated user ids ('mine' is resolved to the current user id on
  // the client before sending). Empty/absent = everyone.
  assignee: z.string().trim().optional(),
  work_order_id: z.string().uuid('Ogiltig arbetsorder').optional(),
  customer_id: z.string().uuid('Ogiltig kund').optional(),
  // Optional cap override (default 100). Board views that index every work order's
  // Fortnox number pass a higher value so the lookup map isn't truncated.
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  // Pagination offset for the "Visa fler" board.
  offset: z.coerce.number().int().min(0).optional(),
  // Row order. Default (installation_asc) is the board's work queue; 'created_desc' is for
  // callers that want the newest orders, which the default sort puts LAST in the table.
  sort: z.enum(['installation_asc', 'created_desc']).optional(),
});

export const updateCrmWorkOrderSchema = z.object({
  status: workOrderStatusSchema,
  assigned_to: z.preprocess((value) => normalizeOptionalText(value), z.string().uuid('Ogiltig användare').nullable()).optional(),
  desired_installation_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
  notes: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  internal_handoff: z.object({
    desired_installation_date: z.preprocess((value) => normalizeOptionalText(value), dateSchema.nullable()).optional().default(null),
    handoff_notes: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    work_scope: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  }).optional().default({}),
  work_address: z.object({
    street_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    postal_code: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    city: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    delivery_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    invoice_address: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  }).optional().default({}),
  // "Er referens" — kundens formella referens, det enda kontaktvärdet som når Fortnox
  // (YourReference). Skilt från `contact` nedan med flit: den som rättar en kundkontakt ska inte
  // råka skriva om referensen som styr kundens faktura till rätt attestant.
  your_reference: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional(),
  // Kundkontakten — vem vi och installatörerna ringer. Merged into customer_snapshot by the route.
  // Når ALDRIG Fortnox; se FORTNOX_MIRRORED_FIELDS i routen.
  contact: z.object({
    contact_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    email: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    phone: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  }).optional(),
  // Slutkunden på plats — en ANNAN person än kundens kontakt (en byggare beställer jobbet, arbetet
  // utförs åt fastighetsägaren). Fångas i offertformuläret och kunde fram till nu inte rättas efter
  // att ordern skapats, trots att den är den besättningen ringer när de står på adressen:
  // `getWorkOrderCustomerContact` låter den vinna över kundens kontakt.
  //
  // Når ALDRIG Fortnox — lika lite som `contact`. Noteringen som en gång bar den till dokumenten
  // (buildEndContactNote) är borttagen och `Remarks` skickas inte alls, så fältet står medvetet
  // UTANFÖR FORTNOX_MIRRORED_FIELDS.
  //
  // Alla tre nycklarna skrivs när objektet skickas, null inkluderat: det är så toggeln stängs av.
  end_contact: z.object({
    end_contact_name: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    end_contact_phone: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
    end_contact_email: z.preprocess((value) => normalizeOptionalText(value), z.string().nullable()).optional().default(null),
  }).optional(),
});

