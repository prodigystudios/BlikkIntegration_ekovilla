import { resolveJobAddress } from '@/lib/domains/planning/display';
import type { WorkOrderCrewPerson } from '@/lib/domains/planning/workOrderCrew';

import { lookupDirectoryPhone, type KmaDirectoryEntry } from './directory';
import { kmaMaterialsFromLineItems } from './materials';
import { parseStoredKmaInput } from './schemas';
import {
  KMA_A8_ONGOING_ROWS,
  KMA_MAX_CONTACTS,
  KMA_DEFAULT_COMMITMENT,
  KMA_DEFAULT_DEVIATION_RECIPIENT,
  KMA_DEFAULT_WORK_TYPE,
  KMA_SELF_CHECK_POINTS,
} from './template';
import type { KmaContactRow, KmaFormValues, KmaPerson, KmaSelfCheckKey, KmaSignerRow } from './types';

// Förifyllnaden av KMA-dialogen: vad ordern, planeringen, kontaktlistan och tidigare planer redan
// vet, så att den som skapar planen bara justerar det projektspecifika.
//
// KÄLLORNA, i den ordning de väger:
//   * Revidera — ORDENS senaste plan kopieras rakt av. En revision är samma plan, ändrad; allt som
//     skrevs förra gången står kvar.
//   * Ny plan — projektfälten ur ORDERN; organisationsblocket (KMA-ansvarig, arbetsmiljö-, miljö- och
//     kvalitetsansvarig, arbetsplatsronder, avvikelser, egenkontrollens ansvariga, verifierande
//     signerare) ur MIN senaste plan, annars BOLAGETS senaste, annars tomt. Värdena skiljer sig per
//     arbetsledare och region, och "min senaste" fångar det utan en inställningssida. Dialogen visar
//     varifrån blocket kom, så ett ärvt fel syns innan det sprids.
//   * Besättningen och säljaren ur planeringen och ordern; telefonnummer ur Kontaktlistan.
//
// ⚠️ TELEFON BARA VID EXAKT, ENTYDIG NAMNTRÄFF — regeln bor i directory.ts, som även dialogen läser.
//
// ⚠️ LÄSER ALDRIG handoff_notes, work_scope eller personnummer. Arbetsbeskrivningen bär portkoder,
// och dokumentet går ut ur huset. Ordertypen nedan är smal med flit: fälten som inte finns här kan
// inte råka hamna i planen.

export { lookupDirectoryPhone, type KmaDirectoryEntry } from './directory';

/** De delar av arbetsordern förifyllnaden får se. */
export type KmaOrderSource = {
  project_name: string | null;
  client_name: string | null;
  order_number: string | null;
  fortnox_order_number: string | null;
  work_address: Record<string, unknown> | null;
  customer_snapshot: Record<string, unknown> | null;
  rot_details: { property_designation?: string | null } | null;
  line_items: unknown;
  assignee: { full_name?: string | null } | null;
};

/** En tidigare sparad plan, som källa till förifyllnaden. */
export type KmaStoredPlanSource = {
  input: unknown;
  project_name: string;
  issued_on: string;
  created_by_name: string;
  revision: number;
};

export type KmaPrefillSource =
  | { kind: 'revision'; revision: number; issuedOn: string }
  | { kind: 'mine' | 'company'; projectName: string; issuedOn: string; createdByName: string }
  | { kind: 'blank' };

export type KmaPrefill = {
  form: KmaFormValues;
  /** Varifrån organisationsblocket kom — visas i dialogen. */
  source: KmaPrefillSource;
  /**
   * Ordern HAR en tidigare revision, men dess formulär gick inte att läsa (en äldre form). Då
   * förifylls dialogen på nytt — och det måste SYNAS, annars ser en revidering ut som en helt ny
   * plan och allt den förra sa försvinner utan förvarning.
   */
  unreadableRevision: number | null;
  /** Planeringens besättning, för "Hämta besättning från planeringen" vid revidering. */
  suggestions: { crewContacts: KmaContactRow[]; crewSigners: KmaSignerRow[] };
};

const blankPerson = (): KmaPerson => ({ name: '', phone: '', email: '' });

/** Ärvd person, med numret uppdaterat ur Kontaktlistan när den ger ett entydigt svar. */
function refreshPerson(person: KmaPerson, directory: readonly KmaDirectoryEntry[]): KmaPerson {
  const phone = lookupDirectoryPhone(directory, person.name);
  return { ...person, phone: phone || person.phone };
}

const defaultSelfCheck = (): Record<KmaSelfCheckKey, string> =>
  Object.fromEntries(KMA_SELF_CHECK_POINTS.map((p) => [p.key, p.defaultResponsible])) as Record<KmaSelfCheckKey, string>;

/** Rått Fortnox-nummer, annars AO-numret — samma regel som orderLookupRef. Aldrig '#'. */
export function kmaProjectNumber(order: Pick<KmaOrderSource, 'order_number' | 'fortnox_order_number'>): string {
  return (order.fortnox_order_number?.trim() || order.order_number?.trim() || '').replace(/^#/, '');
}

/** "Fastighet:" — fastighetsbeteckningen när ordern har en, och adressen. */
export function kmaPropertyLine(order: Pick<KmaOrderSource, 'work_address' | 'customer_snapshot' | 'rot_details'>): string {
  const address = resolveJobAddress(order.work_address, order.customer_snapshot) ?? '';
  const designation = order.rot_details?.property_designation?.trim() ?? '';
  return [designation, address].filter(Boolean).join(', ');
}

function crewSuggestions(crew: readonly WorkOrderCrewPerson[], directory: readonly KmaDirectoryEntry[]) {
  const role = (person: WorkOrderCrewPerson) => (person.leader ? 'Ledande installatör' : 'Installatör');
  return {
    crewContacts: crew.map((person) => ({
      name: person.member_name,
      role: role(person),
      phone: lookupDirectoryPhone(directory, person.member_name),
    })),
    // Mallens tabell har tio rader — fler ryms inte, och resten får skrivas till för hand.
    crewSigners: crew.slice(0, KMA_A8_ONGOING_ROWS).map((person) => ({ name: person.member_name, role: role(person) })),
  };
}

export function buildKmaPrefill(input: {
  order: KmaOrderSource;
  crew: readonly WorkOrderCrewPerson[];
  directory: readonly KmaDirectoryEntry[];
  /** Säljarens namn som sidan redan har — ett standardvärde i ett redigerbart fält, ingen behörighet. */
  salesName: string | null;
  /** Ordens senaste plan (Revidera). */
  orderLatest: KmaStoredPlanSource | null;
  /** Min senaste plan, på vilken order som helst. */
  mineLatest: KmaStoredPlanSource | null;
  /** Bolagets senaste plan. */
  companyLatest: KmaStoredPlanSource | null;
}): KmaPrefill {
  const { order, crew, directory } = input;
  const suggestions = crewSuggestions(crew, directory);

  // ── Revidera: ordens senaste plan, rakt av ─────────────────────────────────
  const revised = input.orderLatest ? parseStoredKmaInput(input.orderLatest.input) : null;
  if (revised && input.orderLatest) {
    return {
      form: revised,
      source: { kind: 'revision', revision: input.orderLatest.revision, issuedOn: input.orderLatest.issued_on },
      unreadableRevision: null,
      suggestions,
    };
  }
  const unreadableRevision = input.orderLatest ? input.orderLatest.revision : null;

  // ── Ny plan ────────────────────────────────────────────────────────────────
  const inheritedFrom = [
    { kind: 'mine' as const, plan: input.mineLatest },
    { kind: 'company' as const, plan: input.companyLatest },
  ]
    .map(({ kind, plan }) => ({ kind, plan, parsed: plan ? parseStoredKmaInput(plan.input) : null }))
    .find((candidate) => candidate.parsed !== null);
  const inherited = inheritedFrom?.parsed ?? null;

  const salesName = (order.assignee?.full_name || input.salesName || '').trim();
  const salesContact: KmaContactRow[] = salesName
    ? [{ name: salesName, role: 'Försäljningsansvarig', phone: lookupDirectoryPhone(directory, salesName) }]
    : [];

  const property = kmaPropertyLine(order);

  const form: KmaFormValues = {
    v: 1,
    project: {
      projectName: (order.project_name ?? '').trim(),
      customerName: (order.client_name ?? '').trim(),
      projectNumber: kmaProjectNumber(order),
      properties: property ? [property] : [],
      workType: inherited?.project.workType || KMA_DEFAULT_WORK_TYPE,
      commitment: KMA_DEFAULT_COMMITMENT,
      materials: kmaMaterialsFromLineItems(order.line_items),
    },
    organisation: inherited
      ? {
          projectManager: refreshPerson(inherited.organisation.projectManager, directory),
          workEnvironment: refreshPerson(inherited.organisation.workEnvironment, directory),
          environment: refreshPerson(inherited.organisation.environment, directory),
          quality: refreshPerson(inherited.organisation.quality, directory),
          siteRoundsBy: inherited.organisation.siteRoundsBy,
          deviationRecipient: inherited.organisation.deviationRecipient,
        }
      : {
          projectManager: blankPerson(),
          workEnvironment: blankPerson(),
          environment: blankPerson(),
          quality: blankPerson(),
          siteRoundsBy: '',
          deviationRecipient: KMA_DEFAULT_DEVIATION_RECIPIENT,
        },
    selfCheckResponsible: inherited ? { ...inherited.selfCheckResponsible } : defaultSelfCheck(),
    // Kapad vid schemats tak — annars kunde en stor besättning ge ett formulär som inte går att spara.
    contacts: [...salesContact, ...suggestions.crewContacts].slice(0, KMA_MAX_CONTACTS),
    signers: {
      ongoing: suggestions.crewSigners,
      verifying: inherited ? inherited.signers.verifying.map((s) => ({ ...s })) : [],
    },
    // Risker är projektspecifika — de ärvs aldrig från en annan order.
    extraRisks: [],
  };

  const source: KmaPrefillSource =
    inheritedFrom && inheritedFrom.plan
      ? {
          kind: inheritedFrom.kind,
          projectName: inheritedFrom.plan.project_name,
          issuedOn: inheritedFrom.plan.issued_on,
          createdByName: inheritedFrom.plan.created_by_name,
        }
      : { kind: 'blank' };

  return { form, source, unreadableRevision, suggestions };
}
