// Orderbekräftelsen och följesedeln i Ekovillas egen formgivning.
//
// Layouten bor i `documentPdfDesign.ts` och delas med offerten. Den här modulen gör det som är
// SPECIFIKT för en Fortnox-ORDER: normaliserar svaret till den form renderaren läser, bygger de två
// varianterna och avgör var ROT-uppgifterna hör hemma.
//
// 🧨 **ORDERRADER HAR INGET `Quantity`.** Fortnox namnger kvantiteten olika per dokumenttyp —
// offertraden bär `Quantity`, orderraden `OrderedQuantity` och `DeliveredQuantity`, fakturaraden
// `DeliveredQuantity`. Renderaren läser `Quantity`, så en order som skickas in oöversatt kommer ut
// med "0,00" på varje rad utan att något klagar: fältet saknas, `formatQuantity(undefined)` ger en
// nolla och dokumentet ser fullt renderat ut. Därför normaliseras raderna här, en gång.
//
// Samma arbetsdelning som för offerten: BELOPPEN ÄGS AV FORTNOX. Vi räknar ingenting om, och
// fakturan skapas sedan av Fortnox ur orderns egna rader.

import { buildRotPropertyNote } from './helpers';
import {
  renderDocumentPdfDesign,
  type DesignDocumentHeader,
  type DesignDocumentRow,
  type DocumentVariant,
} from './documentPdfDesign';
import type {
  FortnoxCompanySettingsResponse,
  FortnoxTaxReductionResponse,
} from './offerPdf';

// ── Fortnox-orderns form (bara fälten vi ritar) ──────────────────────────────

export type FortnoxOrderRowResponse = {
  ArticleNumber?: string | null;
  Description?: string | null;
  /** Beställt antal. Fortnox motsvarighet till offertradens `Quantity`. */
  OrderedQuantity?: string | number | null;
  /** Levererat antal. Vi sätter det alltid lika med det beställda vid pushen (se buildOrderRows). */
  DeliveredQuantity?: string | number | null;
  Unit?: string | null;
  Price?: number | null;
  Discount?: number | null;
  DiscountType?: string | null;
  Total?: number | null;
  VAT?: number | null;
};

export type FortnoxOrderResponse = {
  DocumentNumber?: string | null;
  OrderDate?: string | null;
  DeliveryDate?: string | null;
  /** Offerten ordern skapades ur. Sätts av Fortnox vid `createorder`; saknas på en fristående order. */
  OfferReference?: string | number | null;
  CustomerNumber?: string | null;
  CustomerName?: string | null;
  Address1?: string | null;
  Address2?: string | null;
  ZipCode?: string | null;
  City?: string | null;
  DeliveryAddress1?: string | null;
  DeliveryZipCode?: string | null;
  DeliveryCity?: string | null;
  OurReference?: string | null;
  YourReference?: string | null;
  /** "Ert referensnummer" på ordern — orderns motsvarighet till offertens `YourReferenceNumber`. */
  YourOrderNumber?: string | null;
  TermsOfPayment?: string | null;
  Currency?: string | null;
  Net?: number | null;
  TotalVAT?: number | null;
  RoundOff?: number | null;
  Total?: number | null;
  TotalToPay?: number | null;
  TaxReduction?: number | null;
  TaxReductionType?: string | null;
  OrderRows?: FortnoxOrderRowResponse[] | null;
};

/**
 * Hör skattereduktionsposten till just den här ordern?
 *
 * Tvilling till `belongsToOffer` i `offerPdf.ts`, och medvetet en egen kopia: den modulen är vår
 * kopia av Fortnox utskriftsmall och ska bort när den nya formgivningen suttit ett tag. Att låta
 * orderns väg bero på den hade bundit fast den.
 *
 * Skälet att kontrollera i efterhand är detsamma: `/taxreductions?filter=orders&referencenumber=N`
 * filtrerar på serverns sida, men Fortnox numrerar offerter, ordrar och fakturor i SKILDA serier.
 * Skulle filtret tolkas fel får vi tillbaka en annan kunds post — och då trycks främmande namn OCH
 * fullständigt personnummer på ett dokument som mejlas ut.
 */
export function belongsToOrder(entry: FortnoxTaxReductionResponse, orderNumber: string): boolean {
  if ((entry.ReferenceDocumentType ?? '').toUpperCase() !== 'ORDER') return false;
  return String(entry.ReferenceNumber ?? '') === String(orderNumber);
}

// ── Normalisering ────────────────────────────────────────────────────────────

/**
 * Orderraderna i den form renderaren läser: `OrderedQuantity` flyttad till `Quantity`.
 *
 * ⚠️ **Det beställda antalet, inte det levererade.** De är alltid lika (`buildOrderRows` sätter
 * båda från samma tal), men det beställda är det vi lovat kunden och det enda av de två som en
 * ändring i CRM garanterat når. Skulle någon justera `DeliveredQuantity` i Fortnox ska vår
 * orderbekräftelse fortsätta visa vad ordern lyder på.
 */
export function orderRowsToDesignRows(rows: FortnoxOrderRowResponse[] | null | undefined): DesignDocumentRow[] {
  return (Array.isArray(rows) ? rows : []).map(({ OrderedQuantity, DeliveredQuantity: _ignored, ...rest }) => ({
    ...rest,
    Quantity: OrderedQuantity ?? 0,
  }));
}

/** Orderhuvudet i den form renderaren läser. Bara namnbyten — inga värden räknas om. */
export function orderToDesignHeader(order: FortnoxOrderResponse): DesignDocumentHeader {
  return {
    DocumentNumber: order.DocumentNumber,
    CustomerNumber: order.CustomerNumber,
    CustomerName: order.CustomerName,
    Address1: order.Address1,
    Address2: order.Address2,
    ZipCode: order.ZipCode,
    City: order.City,
    DeliveryAddress1: order.DeliveryAddress1,
    DeliveryZipCode: order.DeliveryZipCode,
    DeliveryCity: order.DeliveryCity,
    OurReference: order.OurReference,
    YourReference: order.YourReference,
    YourReferenceNumber: order.YourOrderNumber,
    TermsOfPayment: order.TermsOfPayment,
    Currency: order.Currency,
    Net: order.Net,
    TotalVAT: order.TotalVAT,
    RoundOff: order.RoundOff,
    Total: order.Total,
    TotalToPay: order.TotalToPay,
    TaxReduction: order.TaxReduction,
    TaxReductionType: order.TaxReductionType,
  };
}

// ── ROT ──────────────────────────────────────────────────────────────────────

type RotDetails = { property_designation?: string | null; brf_org_number?: string | null } | null | undefined;

/**
 * Var fastighetsbeteckningen står på ordern — huvudets referensnummer eller ROT-blocket.
 *
 * 🧨 **De två halvorna får aldrig avgöras var för sig.** `resolveRotReference` fyller exakt EN av
 * dem vid pushen: på en VILLA *är* beteckningen kundens referensnummer (Fortnox har inget fält för
 * den), på en BOSTADSRÄTT ryms beteckning + BRF org.nr inte i ett fält och rider som textrad i
 * stället. Samma regel som `partialInvoiceRotPropertyNote` speglar för delfakturan.
 *
 * Vi visar beteckningen alltid i ROT-blocket, där den hör hemma, och tar då bort referensraden när
 * den bär exakt samma värde — annars stod den två gånger på samma sida. Bostadsrättsfallet rör
 * inget: där bär referensnumret kundens märkning och beteckningen kommer ur radlistan.
 *
 * ⚠️ Jämförelsen görs på VÄRDE, inte på "huvudet bär något". Bär ordern ett annat referensnummer —
 * beteckningen rättad i CRM efter en misslyckad header-synk, eller något ekonomi skrivit in för
 * hand i Fortnox — står båda kvar. Att kundens egen märkning tyst försvinner vore värre.
 */
export function resolveOrderRotPresentation(
  rot: RotDetails,
  rotEnabled: boolean,
  orderReferenceNumber: string | null | undefined,
): { referenceNumber: string; propertyNote: string | null } {
  const reference = (orderReferenceNumber ?? '').trim();
  if (!rotEnabled) return { referenceNumber: reference, propertyNote: null };

  const designation = rot?.property_designation?.trim();
  const borrowed = !!designation && reference === designation;
  return { referenceNumber: borrowed ? '' : reference, propertyNote: buildRotPropertyNote(rot) };
}

// ── Varianter ────────────────────────────────────────────────────────────────

/** Dröjsmålsräntan visas i huvudet men returneras inte av Fortnox — samma värde som på offerten. */
const LATE_INTEREST = '8%';

/**
 * Titelblockets rader. Tomma värden UTELÄMNAS, till skillnad från offerten där alla tre alltid
 * finns: en order utan leveransdatum hade annars fått en naken etikett utan värde efter sig.
 */
function orderMeta(order: FortnoxOrderResponse): Array<[string, string]> {
  return ([
    ['Ordernr', order.DocumentNumber ?? ''],
    ['Orderdatum', order.OrderDate ?? ''],
    ['Leveransdatum', order.DeliveryDate ?? ''],
  ] as Array<[string, string]>).filter(([, value]) => value.trim() !== '');
}

export function orderVariant(order: FortnoxOrderResponse, referenceNumber: string): DocumentVariant {
  return {
    kind: 'order',
    title: 'ORDERBEKRÄFTELSE',
    meta: orderMeta(order),
    references: [
      ['Er referens', order.YourReference ?? ''],
      ['Ert referensnr', referenceNumber],
      ['Vår referens', order.OurReference ?? ''],
      // Sätts av Fortnox när ordern skapas ur en offert (`createorder`); tom på en fristående
      // order, och raden utgår då av sig själv.
      ['Vårt offertnr', order.OfferReference == null ? '' : String(order.OfferReference)],
      ['Betalningsvillkor', order.TermsOfPayment ? `${order.TermsOfPayment} dagar` : ''],
      ['Dröjsmålsränta', LATE_INTEREST],
    ],
    totalLabel: 'TOTALT ORDERVÄRDE',
    showPrices: true,
    showRot: true,
  };
}

/**
 * Följesedeln — leveransdokumentet, utan ett enda belopp.
 *
 * ⛔ **Inga priser, ingen summering, inget ROT.** Den följer med materialet till arbetsplatsen och
 * kvitteras av den som tar emot, som inte nödvändigtvis är den som ska se vad jobbet kostar (en
 * platschef, en granne, en beställares underentreprenör). Betalningsvillkor och dröjsmålsränta
 * utgår av samma skäl — de hör till fakturan, inte till leveransen.
 */
export function deliveryNoteVariant(order: FortnoxOrderResponse): DocumentVariant {
  return {
    kind: 'delivery',
    title: 'FÖLJESEDEL',
    meta: orderMeta(order),
    references: [
      ['Er referens', order.YourReference ?? ''],
      ['Ert referensnr', order.YourOrderNumber ?? ''],
      ['Vår referens', order.OurReference ?? ''],
    ],
    totalLabel: '',
    showPrices: false,
    showRot: false,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

export type OrderPdfDesignInput = {
  order: FortnoxOrderResponse;
  company: FortnoxCompanySettingsResponse;
  customerVatNumber?: string | null;
  /** Redan filtrerade med `belongsToOrder`. Se `documentPdfDesign` för varför det är anroparens jobb. */
  taxReductions?: FortnoxTaxReductionResponse[];
  /** Arbetsorderns ROT-uppgifter (`resolveOrderRotDetails`). Fortnox har inget fält för beteckningen. */
  rotDetails?: RotDetails;
  rotEnabled?: boolean;
  logo?: Uint8Array | null;
  fonts?: { regular: Uint8Array; bold: Uint8Array } | null;
};

export function renderOrderPdfDesign(input: OrderPdfDesignInput): Promise<Uint8Array> {
  const { order, rotDetails, rotEnabled, ...shared } = input;
  const rot = resolveOrderRotPresentation(rotDetails, rotEnabled === true, order.YourOrderNumber);

  return renderDocumentPdfDesign({
    ...shared,
    variant: orderVariant(order, rot.referenceNumber),
    header: orderToDesignHeader(order),
    rows: orderRowsToDesignRows(order.OrderRows),
    rotPropertyNote: rot.propertyNote,
  });
}

export function renderDeliveryNotePdf(input: OrderPdfDesignInput): Promise<Uint8Array> {
  const { order, rotDetails: _rot, rotEnabled: _enabled, taxReductions: _tax, ...shared } = input;

  return renderDocumentPdfDesign({
    ...shared,
    variant: deliveryNoteVariant(order),
    header: orderToDesignHeader(order),
    rows: orderRowsToDesignRows(order.OrderRows),
  });
}
