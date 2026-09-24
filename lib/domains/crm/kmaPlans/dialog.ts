import type { ZodError } from 'zod';

import { lookupDirectoryPhone, normalizeKmaName, normalizeKmaPhone, type KmaDirectoryEntry } from './directory';
import { KMA_A8_ONGOING_ROWS, KMA_MAX_CONTACTS } from './template';
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

/**
 * Ett val i förslagslistan: namnet OCH just den postens nummer. Till skillnad från en uppslagning på
 * namnet (renameKmaRow) vet vi här exakt vilken person som valdes — två med samma namn och olika
 * nummer går att skilja åt, där en namnuppslagning hade svarat tomt för båda.
 *
 * E-posten står kvar bara om det är SAMMA person: samma namn, och raden har inget nummer ännu eller
 * samma nummer som valet. 🧨 Att jämföra namnen räckte inte — valdes den ANDRA "Johan Andersson"
 * fick raden hans nummer men den förstes e-post, och planen parade ihop två personers uppgifter.
 *
 * Rollen rörs inte: den hör till PLATSEN i planen ("Ledande installatör"), inte till personen — den
 * som byter person på raden byter vem som fyller platsen. Kontaktlistans titlar ("Säljare /
 * Ledning") är dessutom ett annat ordförråd än planens.
 */
export function pickKmaDirectoryEntry<T extends { name: string; phone: string; email?: string }>(row: T, entry: KmaDirectoryEntry): T {
  const phone = entry.phone?.trim() ?? '';
  const samePerson =
    normalizeName(row.name) === normalizeName(entry.name) &&
    (!row.phone.trim() || normalizeKmaPhone(row.phone) === normalizeKmaPhone(phone));
  const next = { ...row, name: entry.name, phone };
  if (!samePerson && 'email' in row) (next as { email?: string }).email = '';
  return next;
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

const normalizeName = normalizeKmaName;

/**
 * Ett namn har ändrats: telefonen (och e-posten, där raden har en) FÖLJER NAMNET.
 *
 * 🧨 Det räcker inte att fylla i ett tomt nummer. Ärvs "Erik Lund, 070-111…" och namnet byts till
 * "Per Ek" stod Eriks nummer kvar under Pers namn i planen som går till beställaren — och med både
 * "Anna Berg" och "Anna Bergström" i Kontaktlistan fastnade Anna Bergs nummer när man skrev sig
 * förbi hennes namn. Vid ett nytt namn sätts därför numret om ur Kontaktlistan (tomt om namnet inte
 * ger ett entydigt svar) och e-posten töms. Priset: ett handskrivet nummer eller en e-post får skrivas
 * om efter en namnrättning. Ett tomt fält är bättre än en annan persons uppgifter.
 *
 * En ändring bara i blanksteg eller skiftläge är samma namn och rör ingenting annat.
 */
export function renameKmaRow<T extends { name: string; phone: string; email?: string }>(
  row: T,
  name: string,
  directory: readonly KmaDirectoryEntry[],
): T {
  if (normalizeName(name) === normalizeName(row.name)) return { ...row, name };
  const next = { ...row, name, phone: lookupDirectoryPhone(directory, name) };
  if ('email' in row) (next as { email?: string }).email = '';
  return next;
}

/**
 * "Hämta besättning från planeringen" vid revidering. LÄGGER TILL de som saknas, tar aldrig bort:
 * listan kan vara redigerad för hand sedan förra revisionen, och en knapp som skrev över den hade
 * kastat det arbetet. Löpande signerare stannar vid mallens tio rader, kontakterna vid schemats tak.
 */
export function mergeKmaCrew(
  form: KmaFormValues,
  crew: { crewContacts: KmaContactRow[]; crewSigners: KmaSignerRow[] },
): KmaFormValues {
  const contactNames = new Set(form.contacts.map((c) => normalizeName(c.name)));
  const signerNames = new Set(form.signers.ongoing.map((s) => normalizeName(s.name)));
  // Båda listorna stannar vid schemats tak — en knapp som gav ett formulär som inte går att spara
  // hade varit en återvändsgränd med ett fel utan fält att visa det i.
  const contacts = [...form.contacts, ...crew.crewContacts.filter((c) => !contactNames.has(normalizeName(c.name)))].slice(
    0,
    KMA_MAX_CONTACTS,
  );
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
