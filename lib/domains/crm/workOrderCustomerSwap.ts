// Byta kund på en arbetsorder (del 5 i paritetsprogrammet). Säljare skapar ibland offert och order på
// fel kund; offerten kunde byta kund, ordern inte (William, 2026-10-20).
//
// Williams beslut 2026-10-20:
//   - Fram till första fakturan. Innan Fortnox byts kunden bara i CRM; finns Fortnox-ordern byter den
//     kund också (fortnox/orders.ts, orderCustomerSwapFields). Har faktureringen börjat — en del eller
//     allt — har fakturan redan gått till den nuvarande kunden, och bytet nekas.
//   - Bara samma kundtyp och samma moms. Ett byte mellan privat och företag, eller mellan omvänd
//     skattskyldighet och vanlig moms, hade räknat om priserna och ROT-regimen och nekas.
//   - Offerten står kvar på den gamla kunden — den är det som faktiskt skickades.
//   - Kontaktperson och Er referens blir den nya kundens. Arbetsadressen väljs i dialogen: förvalet är
//     att behålla den, utom när den är den gamla kundens egen adress.
//   - Portalordrar är utanför (mitt val, nämnt): deras kund följer butikens kundnummer.
//
// Ren modul: reglerna och vad som skrivs. Läsningen, skrivningen och Fortnox sköts av
// swapWorkOrderCustomer.ts. Dialogen läser samma regler, så knappen och servern säger samma sak.

import { getCrmCustomerDisplayName } from './customers';
import { evaluateWorkOrderReadiness, joinSwedish, type WorkOrderReadinessIssue } from './workOrderReadiness';
import { JOB_CUSTOMER_SELECT, portalCustomerIdentity, type JobCustomerCard } from '@/lib/domains/portal/jobIntake';

/** Det nya kundkortet. Samma kolumner som portalens koppling, plus momsen och Fortnox-numret. */
export type SwapCustomerCard = JobCustomerCard & {
  reverse_vat: boolean | null;
  fortnox_customer_id: string | null;
};

export const SWAP_CUSTOMER_SELECT = `${JOB_CUSTOMER_SELECT}, reverse_vat, fortnox_customer_id`;

export type SwappableWorkOrder = {
  id: string;
  status: string | null;
  quote_id: string | null;
  customer_id: string | null;
  prospect_id: string | null;
  quote_type: 'private' | 'business';
  customer_snapshot: Record<string, unknown> | null;
  work_address: Record<string, unknown> | null;
  rot_details: Record<string, unknown> | null;
  line_items: Array<Record<string, unknown>> | null;
  internal_handoff: Record<string, unknown> | null;
  fortnox_order_number: string | null;
  updated_at: string;
};

export const SWAPPABLE_WORK_ORDER_SELECT =
  'id, status, quote_id, customer_id, prospect_id, quote_type, customer_snapshot, work_address, rot_details, line_items, internal_handoff, fortnox_order_number, fortnox_invoice_number, partial_invoicing_started_at, updated_at';

export type CustomerSwapBlock = 'same_customer' | 'cancelled' | 'invoiced' | 'portal' | 'customer_type' | 'reverse_vat';

export type CustomerSwapContext = {
  /** Har faktureringen börjat, en del eller allt? Avgörs av anroparen (workOrderInvoicingStarted + helfakturerad). */
  invoiced: boolean;
  isPortalJob: boolean;
  /** Orderns moms just nu: snapshotens flagga, annars det nuvarande kortets — samma val som resolveReverseVat. */
  currentReverseVat: boolean;
};

/** Varför kunden inte får bytas, eller null när den får det. Ordningen är den som säger mest först. */
export function customerSwapBlock(
  order: Pick<SwappableWorkOrder, 'status' | 'customer_id' | 'quote_type'>,
  card: Pick<SwapCustomerCard, 'id' | 'customer_type' | 'reverse_vat'>,
  ctx: CustomerSwapContext,
): CustomerSwapBlock | null {
  if (order.customer_id === card.id) return 'same_customer';
  if (order.status === 'cancelled') return 'cancelled';
  if (ctx.invoiced) return 'invoiced';
  if (ctx.isPortalJob) return 'portal';
  if (order.quote_type !== card.customer_type) return 'customer_type';
  // Bara för företag: omvänd skattskyldighet gäller aldrig en privatperson.
  if (card.customer_type === 'business' && (card.reverse_vat === true) !== ctx.currentReverseVat) return 'reverse_vat';
  return null;
}

const typeWord = (type: 'private' | 'business') => (type === 'private' ? 'en privatkund' : 'ett företag');
const vatWord = (reverseVat: boolean) => (reverseVat ? 'omvänd skattskyldighet' : 'vanlig moms');

/** Det användaren läser när bytet nekas — i dialogen och i ruttens svar. */
export function customerSwapBlockMessage(
  block: CustomerSwapBlock,
  order: { quote_type: 'private' | 'business'; reverseVat: boolean },
): string {
  switch (block) {
    case 'same_customer':
      return 'Ordern har redan den kunden.';
    case 'cancelled':
      return 'Ordern är avbruten. Kunden byts inte på en avbruten order.';
    case 'invoiced':
      return 'Faktureringen av ordern har börjat, och fakturan har gått till den nuvarande kunden. Kreditera fakturan i Fortnox och lägg ordern på rätt kund på nytt.';
    case 'portal':
      return 'Ordern kom från partnerportalen, och dess kund följer butikens kundnummer. Den byts inte här.';
    case 'customer_type':
      return `Ordern gäller ${typeWord(order.quote_type)}. Ett byte mellan privatkund och företag räknar om priserna och ROT, och kräver en ny order.`;
    case 'reverse_vat':
      return `Ordern har ${vatWord(order.reverseVat)}, den nya kunden ${vatWord(!order.reverseVat)}. Ett byte mellan momsreglerna räknar om priserna, och kräver en ny order.`;
  }
}

type SiteParts = { street_address: string | null; postal_code: string | null; city: string | null };

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t : null;
};

const sameStreet = (a: string | null, b: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/**
 * Var jobbet görs i dag — samma ordning som planeringen och fältvyn läser den (resolveJobAddress):
 * orderns egen kolumn, annars snapshotens arbetsadress, annars kundens adress. Som en ENHET, aldrig
 * fält för fält mellan källorna: en gata från ett håll och en ort från ett annat är fel stad.
 */
export function currentJobSite(order: Pick<SwappableWorkOrder, 'work_address' | 'customer_snapshot'>): SiteParts {
  const wa = order.work_address ?? {};
  if (text(wa.street_address)) return { street_address: text(wa.street_address), postal_code: text(wa.postal_code), city: text(wa.city) };
  const snap = order.customer_snapshot ?? {};
  if (text(snap.delivery_address)) {
    return { street_address: text(snap.delivery_address), postal_code: text(snap.delivery_postal_code), city: text(snap.delivery_city) };
  }
  return { street_address: text(snap.street_address), postal_code: text(snap.postal_code), city: text(snap.city) };
}

export type WorkAddressChoice = 'keep' | 'customer';

/**
 * Dialogens förval. Behåll arbetsadressen — jobbet ligger där det ligger, vem som än betalar — UTOM
 * när den är den gamla kundens egen adress: då kom den från fel kundkort (vanligast på en privatkund,
 * där kundens adress ÄR arbetsplatsen), och den nya kundens adress är den troliga.
 */
export function defaultWorkAddressChoice(order: Pick<SwappableWorkOrder, 'work_address' | 'customer_snapshot'>): WorkAddressChoice {
  const site = currentJobSite(order);
  if (!site.street_address) return 'customer';
  return sameStreet(site.street_address, text(order.customer_snapshot?.street_address)) ? 'customer' : 'keep';
}

/** Den nya kundens adress (besöksadressen), som den blir på ordern. */
export function customerSite(card: SwapCustomerCard): SiteParts {
  const identity = portalCustomerIdentity(card);
  return { street_address: text(identity.street_address), postal_code: text(identity.postal_code), city: text(identity.city) };
}

const isFilled = (value: Record<string, unknown> | null | undefined) => Boolean(value && Object.keys(value).length > 0);

/**
 * Vad som skrivs på arbetsordern.
 *
 *   - Vem kunden är (namn, org.nr/personnummer, adress) och kundkontakten + Er referens: kortets, ur
 *     samma mappning som portalens koppling (portalCustomerIdentity). Märkningen och kontakten på
 *     plats (slutkunden) är jobbets och står kvar.
 *   - Arbetsplatsen skrivs ALLTID ut i kolumnen, även när den behålls. Annars hade en order som läser
 *     den ur snapshotens kundadress flyttat tyst med kunden.
 *   - ROT-sökanden blir den nya kunden. 🧨 En order med tomma ROT-uppgifter läser OFFERTENS
 *     (resolveOrderRotDetails), och offerten står kvar på den gamla kunden — de kopieras därför hit
 *     (`fallbackRot`), annars hade skattereduktionen burit den gamla sökanden.
 *   - `fortnox_customer_number`: numret Fortnox-ordern ska ha. Pushen jämför och byter (orders.ts).
 *   - `prospect_id` släpps när det pekar på den gamla kunden — annars spärrar ordern den gamla
 *     kundens kort från att raderas, fast den inte längre har något med kortet att göra.
 *   - Kundtyp, moms och priser rörs inte: bytet kräver samma kundtyp och moms (customerSwapBlock).
 */
export function buildWorkOrderCustomerSwapUpdate(
  order: SwappableWorkOrder,
  card: SwapCustomerCard,
  opts: { workAddress: WorkAddressChoice; fallbackRot: Record<string, unknown> | null; fortnoxCustomerNumber: string | null },
): Record<string, unknown> {
  const identity = portalCustomerIdentity(card);
  const site = opts.workAddress === 'customer' ? customerSite(card) : currentJobSite(order);
  // Snapshotens arbetsadress bara när den skiljer sig från kundens — samma regel som offerten
  // (buildCustomerSnapshot). Annars får Fortnox ett leveransblock med kundens egen adress.
  const separateSite = Boolean(site.street_address) && !sameStreet(site.street_address, text(identity.street_address));

  const baseRot = isFilled(order.rot_details) ? order.rot_details! : (opts.fallbackRot ?? {});
  const rotEnabled = baseRot.enabled === true;
  const rotDetails = isFilled(baseRot)
    ? { ...baseRot, applicant_name: rotEnabled ? identity.customer_name : null, personal_number: rotEnabled ? identity.personal_number : null }
    : order.rot_details;

  return {
    customer_id: card.id,
    client_name: getCrmCustomerDisplayName(card),
    ...(order.prospect_id && order.prospect_id === order.customer_id ? { prospect_id: null } : {}),
    customer_snapshot: {
      ...(order.customer_snapshot ?? {}),
      ...identity,
      // Den gamla kundens fria adressfält ur offerten; kortet läses när de behövs.
      visit_address: null,
      invoice_address: null,
      delivery_address: separateSite ? site.street_address : null,
      delivery_postal_code: separateSite ? site.postal_code : null,
      delivery_city: separateSite ? site.city : null,
      reverse_vat: card.reverse_vat === true,
      fortnox_customer_number: opts.fortnoxCustomerNumber,
    },
    work_address: { ...(order.work_address ?? {}), ...site },
    rot_details: rotDetails,
  };
}

/**
 * Det nya kortet prövat med samma kontroll som när en order skapas, på ordern som den blir — men
 * bara det som hör till KUNDEN: personnummer, org.nr och ett telefonnummer besättningen kan ringa.
 * Övriga fynd (ROT-fastigheten, artiklarna …) fanns före bytet och är inte bytets sak.
 *
 * Arbetsadressen prövas här och inte av kontrollen: den läser kortets adress, men ordern behåller
 * kanske sin egen. Bara när den nya kundens adress väljs måste den vara hel — installatörerna
 * navigerar efter den.
 */
export function customerSwapReadinessBlockers(
  order: SwappableWorkOrder,
  card: SwapCustomerCard,
  update: Record<string, unknown>,
  workAddress: WorkAddressChoice,
): WorkOrderReadinessIssue[] {
  const readiness = evaluateWorkOrderReadiness(
    {
      quote_type: order.quote_type,
      customer_id: card.id,
      customer_snapshot: update.customer_snapshot as Record<string, unknown>,
      rot_details: (update.rot_details ?? order.rot_details) as { enabled?: boolean | null } | null,
      line_items: order.line_items,
      internal_handoff: order.internal_handoff as { desired_installation_date?: string | null } | null,
    },
    card,
  );
  const blockers = readiness.blockers.filter((issue) =>
    issue.field === 'personal_number' || issue.field === 'organization_number' || issue.field === 'contact_phone');

  if (workAddress === 'customer') {
    const site = customerSite(card);
    const missing = [
      site.street_address ? null : 'gatuadress',
      site.postal_code ? null : 'postnummer',
      site.city ? null : 'ort',
    ].filter((part): part is string => part !== null);
    if (missing.length > 0) {
      blockers.push({
        field: 'work_address',
        label: 'Arbetsadress',
        message: `Den nya kundens adress saknar ${joinSwedish(missing)}. Behåll orderns arbetsadress, eller fyll i adressen på kundkortet.`,
        fixAt: 'customer_card',
      });
    }
  }
  return blockers;
}
