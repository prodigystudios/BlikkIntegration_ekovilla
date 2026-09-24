import { z } from 'zod';

import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';

import { KMA_A8_ONGOING_ROWS, KMA_A8_VERIFYING_ROWS, KMA_MAX_CONTACTS } from './template';
import type { KmaDocument, KmaFormValues } from './types';

// Validering av KMA-planens formulär (POST-kroppen) och av ett sparat dokument (före rendering).
//
// Maxlängderna är till för att en rad ska rymmas i sin tabellcell och ett fält på sin rad — inte
// affärsregler. Taken på signaturlistorna följer mallens tabeller: tio löpande, sju verifierande.
//
// ⚠️ Zod släpper okända nycklar. En klient som skickar ett eget bolagsblock ("company": …) får det
// bortfiltrerat här — bolaget är alltid Isoleringslandslaget och kommer ur mallen, aldrig ur kroppen.

const text = (max: number) => z.string().trim().max(max, `Högst ${max} tecken`);
const required = (max: number, message: string) => text(max).min(1, message);

const email = z
  .string()
  .trim()
  .max(160, 'Högst 160 tecken')
  .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Ogiltig e-postadress');

const person = (label: string) =>
  z.object({
    name: required(120, `Ange ${label}`),
    phone: text(40),
    email,
  });

const signer = z.object({
  name: required(120, 'Namn saknas'),
  role: required(80, 'Roll saknas'),
});

export const kmaFormSchema = z.object({
  v: z.literal(1),
  project: z.object({
    projectName: required(200, 'Ange projektnamn'),
    customerName: required(200, 'Ange kund'),
    projectNumber: required(60, 'Ange projektnummer'),
    // Tomma rader filtreras bort: dialogen har alltid en tom rad att skriva i.
    properties: z
      .array(text(200))
      .max(10, 'Högst tio fastigheter')
      .transform((rows) => rows.filter((row) => row.length > 0))
      .refine((rows) => rows.length > 0, 'Ange minst en fastighet eller adress'),
    workType: required(120, 'Ange arbetstyp'),
    commitment: required(200, 'Ange åtagande'),
    materials: z
      .array(z.string())
      .max(MATERIAL_SHORTS.length)
      .refine((list) => list.every((m) => MATERIAL_SHORTS.includes(m)), 'Okänt material')
      .refine((list) => list.length > 0, 'Välj minst ett material'),
  }),
  organisation: z.object({
    projectManager: person('KMA-ansvarig / projektledare'),
    workEnvironment: person('arbetsmiljöansvarig'),
    environment: person('miljöansvarig'),
    quality: person('kvalitetsansvarig'),
    siteRoundsBy: required(120, 'Ange vem som utför arbetsplatsronder'),
    deviationRecipient: required(200, 'Ange vem avvikelser rapporteras till'),
  }),
  selfCheckResponsible: z.object({
    incomingMaterial: required(80, 'Ange ansvarig'),
    density: required(80, 'Ange ansvarig'),
    thickness: required(80, 'Ange ansvarig'),
    airGaps: required(80, 'Ange ansvarig'),
    finalInspection: required(80, 'Ange ansvarig'),
  }),
  contacts: z
    .array(
      z.object({
        name: required(120, 'Namn saknas'),
        role: required(80, 'Roll saknas'),
        phone: text(40),
      }),
    )
    .max(KMA_MAX_CONTACTS, `Högst ${KMA_MAX_CONTACTS} kontakter`),
  signers: z.object({
    ongoing: z.array(signer).max(KMA_A8_ONGOING_ROWS, `Högst ${KMA_A8_ONGOING_ROWS} personer`),
    verifying: z.array(signer).max(KMA_A8_VERIFYING_ROWS, `Högst ${KMA_A8_VERIFYING_ROWS} personer`),
  }),
  extraRisks: z
    .array(
      z.object({
        risk: required(300, 'Beskriv risken'),
        action: required(400, 'Beskriv åtgärden'),
      }),
    )
    .max(10, 'Högst tio extra risker'),
});

// Kompileringsvakt: schemats utdata måste gå att använda som KmaFormValues. Glider de isär slutar
// filen kompilera, i stället för att en rutt tar emot en form som dokumentbyggaren inte känner.
const formShapeGuard = (value: z.infer<typeof kmaFormSchema>): KmaFormValues => value;
void formShapeGuard;

/**
 * En sparad rads `input`, tolerant: en okänd version eller en trasig rad ger null, och förifyllnaden
 * går då vidare till nästa källa i stället för att fälla dialogen.
 */
export function parseStoredKmaInput(raw: unknown): KmaFormValues | null {
  const parsed = kmaFormSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ── Dokumentet ───────────────────────────────────────────────────────────────

// Taken här prövar dokumentets FORM, inte innehållets längd — de måste rymma allt formuläret släpper
// igenom. 🧨 De var 2000, och bilaga 8:s projektcell (kund + projekt + tio fastigheter) blir upp
// till ~2 420 tecken: planen sparades, men PDF:en svarade med ett fel för alltid. Ett test bygger nu
// dokumentet ur ett maximalt formulär och kräver att det klarar schemat.
const cell = z.string().max(8000);

const block = z.discriminatedUnion('t', [
  z.object({ t: z.literal('title'), text: cell, sub: cell.optional() }),
  z.object({ t: z.literal('h1'), text: cell }),
  z.object({ t: z.literal('h2'), text: cell }),
  z.object({ t: z.literal('h3'), text: cell }),
  z.object({ t: z.literal('p'), text: z.string().max(20000), lead: cell.optional() }),
  z.object({ t: z.literal('list'), items: z.array(cell).max(100) }),
  z.object({ t: z.literal('fields'), rows: z.array(z.tuple([cell, cell])).max(50), form: z.boolean().optional() }),
  z.object({
    t: z.literal('table'),
    columns: z.array(z.object({ head: cell, width: z.number().positive() })).min(1).max(12),
    rows: z.array(z.array(cell)).max(200),
    minRows: z.number().int().min(0).max(50).optional(),
    rowMinHeight: z.number().min(0).max(200).optional(),
  }),
  z.object({ t: z.literal('signature'), label: cell }),
  z.object({ t: z.literal('gap'), h: z.number().min(0).max(400) }),
]);

export const kmaDocumentSchema = z.object({
  v: z.literal(1),
  layout: z.literal(1),
  meta: z.object({
    projectName: cell,
    projectNumber: cell,
    revision: z.number().int().min(1),
    issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    firstIssuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  footer: cell,
  running: cell,
  sections: z
    .array(z.object({ key: z.string().max(40), newPage: z.boolean(), blocks: z.array(block).max(400) }))
    .min(1)
    .max(40),
});

/** Ett sparat dokument, eller null om formen inte går att rendera. */
export function parseStoredKmaDocument(raw: unknown): KmaDocument | null {
  const parsed = kmaDocumentSchema.safeParse(raw);
  return parsed.success ? (parsed.data as KmaDocument) : null;
}
