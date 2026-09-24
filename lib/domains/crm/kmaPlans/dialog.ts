import type { ZodError } from 'zod';

import { KMA_A8_ONGOING_ROWS } from './template';
import type { KmaContactRow, KmaFormValues, KmaSignerRow } from './types';
import type { KmaPrefillSource } from './prefill';

// Ren logik för KMA-kortet och -dialogen på arbetsordern (app/crm/arbetsorder/WorkOrderKma*.tsx).
// Här för att kunna prövas utan en webbläsare — repot har ingen testing-library.

/**
 * Vilken knapp kortet visar, om någon.
 *
 * ⚠️ BÅDA villkoren krävs. `canEdit` är vyns läsläge (ekonomins läsvy av samma komponent) och
 * `canCreate` serverns svar på skrivnyckeln (crm.workorder.write, samma som insert-policyn). Ett
 * laddfel visar ingen knapp: vi vet inte om ordern har en plan, och "Skapa" på en order som redan
 * har tre revisioner hade lovat något annat än det som händer.
 */
export function kmaCardAction(input: {
  canEdit: boolean;
  canCreate: boolean;
  hasPlans: boolean;
  loadError: boolean;
}): 'create' | 'revise' | null {
  if (!input.canEdit || !input.canCreate || input.loadError) return null;
  return input.hasPlans ? 'revise' : 'create';
}

/**
 * Raden överst i dialogen: varifrån det förifyllda kom. Ett ärvt organisationsblock ska synas som
 * ärvt, annars sprids ett fel i en plan tyst till nästa.
 */
export function kmaSourceNote(source: KmaPrefillSource, formatDate: (iso: string) => string): string {
  switch (source.kind) {
    case 'revision':
      return `Förifylld med revision ${source.revision} från ${formatDate(source.issuedOn)}. Ändra det som är nytt.`;
    case 'mine':
      return `Organisationen är hämtad från din KMA-plan för ${source.projectName} (${formatDate(source.issuedOn)}). Kontrollera att den stämmer för det här projektet.`;
    case 'company':
      return `Organisationen är hämtad från KMA-planen för ${source.projectName}, skapad av ${source.createdByName} (${formatDate(source.issuedOn)}). Kontrollera att den stämmer.`;
    case 'blank':
      return 'Första KMA-planen: fyll i organisationen en gång, så följer den med till nästa plan.';
  }
}

/** Zod-felen per fält, nycklade på sökvägen ("organisation.projectManager.name"). Första vinner. */
export function kmaFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv');

/**
 * "Hämta besättning från planeringen" vid revidering. LÄGGER TILL de som saknas, tar aldrig bort:
 * listan kan vara redigerad för hand sedan förra revisionen, och en knapp som skrev över den hade
 * kastat det arbetet. Löpande signerare stannar vid mallens tio rader.
 */
export function mergeKmaCrew(
  form: KmaFormValues,
  crew: { crewContacts: KmaContactRow[]; crewSigners: KmaSignerRow[] },
): KmaFormValues {
  const contactNames = new Set(form.contacts.map((c) => normalizeName(c.name)));
  const signerNames = new Set(form.signers.ongoing.map((s) => normalizeName(s.name)));
  const contacts = [...form.contacts, ...crew.crewContacts.filter((c) => !contactNames.has(normalizeName(c.name)))];
  const ongoing = [...form.signers.ongoing, ...crew.crewSigners.filter((s) => !signerNames.has(normalizeName(s.name)))].slice(
    0,
    KMA_A8_ONGOING_ROWS,
  );
  return { ...form, contacts, signers: { ...form.signers, ongoing } };
}

/** Hur många av besättningen som INTE redan står med — styr om knappen visas och vad den säger. */
export function kmaMissingCrewCount(form: KmaFormValues, crewContacts: KmaContactRow[]): number {
  const names = new Set(form.contacts.map((c) => normalizeName(c.name)));
  return crewContacts.filter((c) => !names.has(normalizeName(c.name))).length;
}
