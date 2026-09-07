import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  belongsToOrder,
  deliveryNoteVariant,
  orderRowsToDesignRows,
  orderToDesignHeader,
  orderVariant,
  renderDeliveryNotePdf,
  renderOrderPdfDesign,
  resolveOrderRotPresentation,
  type FortnoxOrderResponse,
  type FortnoxOrderRowResponse,
} from '@/lib/domains/fortnox/orderPdfDesign';
import { isTextOnlyRow, type FortnoxCompanySettingsResponse } from '@/lib/domains/fortnox/offerPdf';

/** Textraderna på en given sida i en renderad PDF. */
async function pageText(bytes: Uint8Array, pageNumber = 1): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  return content.items
    .map((item) => (item as { str?: string }).str ?? '')
    .map((str) => str.trim())
    .filter(Boolean);
}

const COMPANY: FortnoxCompanySettingsResponse = {
  Name: 'EKOVILLA se AB',
  Address: 'Celebra AB, Box 44',
  ZipCode: '81121',
  City: 'Sandviken',
  Phone1: '020-446640',
  Email: 'info@ekovilla.se',
  WWW: 'www.ekovilla.se',
  BG: '541-0469',
  IBAN: 'SE39 1200 0000 0124 0012 9770',
  BIC: 'DABASESX',
  OrganizationNumber: '559341-9673',
  VATNumber: 'SE559341967301',
};

// Orderrad som Fortnox returnerar den. NOTERA att `Quantity` saknas helt — se orderPdfDesign.ts.
const orderRow = (
  ArticleNumber: string,
  Description: string,
  quantity: number,
  Unit: string,
  Price: number,
): FortnoxOrderRowResponse => ({
  ArticleNumber,
  Description,
  OrderedQuantity: quantity,
  DeliveredQuantity: quantity,
  Unit,
  Price,
  Total: quantity * Price,
  VAT: 25,
});

const orderNote = (Description: string): FortnoxOrderRowResponse => ({
  Description,
  OrderedQuantity: 0,
  DeliveredQuantity: 0,
  Price: 0,
  Total: 0,
});

// Påhittad privatperson med ROT. Skarpa kunder hör inte hemma i en committad fixtur — facit
// (Fortnox order 113) ligger utanför repot.
const ROT_ORDER: FortnoxOrderResponse = {
  DocumentNumber: '113',
  OrderDate: '2026-09-04',
  DeliveryDate: '2026-09-18',
  OfferReference: 10152,
  CustomerNumber: '707906730',
  CustomerName: 'Karin Lindqvist',
  Address1: 'Backstigen 12',
  ZipCode: '141 38',
  City: 'Huddinge',
  DeliveryAddress1: 'Sjöstugevägen 4',
  DeliveryZipCode: '134 41',
  DeliveryCity: 'Gustavsberg',
  OurReference: 'Daniel Casselstål',
  YourReference: 'Karin Lindqvist',
  // Villafallet: fastighetsbeteckningen ÄR referensnumret (Fortnox har inget fält för den).
  YourOrderNumber: 'Gustavsberg Sjöstugan 2:14',
  TermsOfPayment: '10',
  Net: 9800,
  TotalVAT: 2450,
  Total: 12250,
  TaxReduction: 2062,
  TaxReductionType: 'rot',
  TotalToPay: 10188,
  OrderRows: [
    orderRow('2410509', 'EKOVILLA cellulosa 0,038W/mK vind', 15, 'M3', 220),
    orderNote('Yta: 200 m², Tjocklek: 400 mm'),
    orderRow('1010', 'Etableringskostnad', 1, 'st', 1000),
    orderRow('10058', 'Arbetskostnad ROT', 1, 'st', 5500),
  ],
};

const ROT_DETAILS = { enabled: true, property_designation: 'Gustavsberg Sjöstugan 2:14' };

const APPLICANTS = [
  { CustomerName: 'Karin Lindqvist', SocialSecurityNumber: '19740312-4519' },
  { CustomerName: 'Erik Lindqvist', SocialSecurityNumber: '19710918-2233' },
];

// Företagsorder utan ROT: märkningen står kvar i referensnumret, inget ROT-block.
const BUSINESS_ORDER: FortnoxOrderResponse = {
  ...ROT_ORDER,
  DocumentNumber: '114',
  CustomerName: 'Byggbolaget i Sandviken AB',
  YourOrderNumber: 'Projekt 483089',
  OfferReference: null,
  TaxReduction: 0,
  TaxReductionType: 'none',
  TotalToPay: 12250,
};

describe('orderRowsToDesignRows', () => {
  it('flyttar OrderedQuantity till Quantity — annars blir varje rad 0,00', () => {
    // 🧨 Felklassen modulen finns för. Renderaren läser `Quantity`, orderraden bär det inte, och
    // `formatQuantity(undefined)` ger "0,00" utan att något kastar. Dokumentet ser komplett ut.
    const [row] = orderRowsToDesignRows([orderRow('2410509', 'Cellulosa', 15, 'M3', 220)]);
    expect(row.Quantity).toBe(15);
    expect(row).not.toHaveProperty('OrderedQuantity');
    expect(row).not.toHaveProperty('DeliveredQuantity');
  });

  it('läser det BESTÄLLDA antalet, inte det levererade', () => {
    const [row] = orderRowsToDesignRows([
      { ...orderRow('2410509', 'Cellulosa', 15, 'M3', 220), DeliveredQuantity: 9 },
    ]);
    expect(row.Quantity).toBe(15);
  });

  it('behåller textraden som textrad', () => {
    // Grupperingen i renderaren vilar på `isTextOnlyRow`, som prövar Quantity/Price/Total. En
    // textrad vars nolla föll bort i översättningen hade blivit en artikelrad utan artikelnummer.
    const [row] = orderRowsToDesignRows([orderNote('Yta: 200 m², Tjocklek: 400 mm')]);
    expect(isTextOnlyRow(row)).toBe(true);
  });

  it('tål att OrderRows saknas', () => {
    expect(orderRowsToDesignRows(null)).toEqual([]);
    expect(orderRowsToDesignRows(undefined)).toEqual([]);
  });
});

describe('orderToDesignHeader', () => {
  it('mappar YourOrderNumber till referensnumret renderaren ritar', () => {
    expect(orderToDesignHeader(ROT_ORDER).YourReferenceNumber).toBe('Gustavsberg Sjöstugan 2:14');
  });

  it('lämnar beloppen orörda — Fortnox äger dem', () => {
    const header = orderToDesignHeader(ROT_ORDER);
    expect(header.Net).toBe(9800);
    expect(header.Total).toBe(12250);
    expect(header.TotalToPay).toBe(10188);
    expect(header.TaxReduction).toBe(2062);
  });
});

describe('belongsToOrder', () => {
  it('släpper igenom orderns egen post', () => {
    expect(belongsToOrder({ ReferenceDocumentType: 'ORDER', ReferenceNumber: 113 }, '113')).toBe(true);
  });

  it('avvisar en OFFERT med samma nummer', () => {
    // Fortnox numrerar dokumenttyperna i skilda serier. Utan typkontrollen kan en främmande kunds
    // fullständiga personnummer hamna på ordern.
    expect(belongsToOrder({ ReferenceDocumentType: 'OFFER', ReferenceNumber: 113 }, '113')).toBe(false);
  });

  it('avvisar ett annat ordernummer', () => {
    expect(belongsToOrder({ ReferenceDocumentType: 'ORDER', ReferenceNumber: 114 }, '113')).toBe(false);
  });
});

describe('varianterna', () => {
  it('utelämnar metaraden när värdet saknas', () => {
    // Offerten har alltid alla tre datumen; en order behöver inte ha ett leveransdatum, och en
    // naken etikett utan värde efter sig ser ut som ett fel.
    const labels = orderVariant({ ...ROT_ORDER, DeliveryDate: null }, 'x').meta.map(([label]) => label);
    expect(labels).toEqual(['Ordernr', 'Orderdatum']);
  });

  it('tar med offertnumret bara när ordern kom ur en offert', () => {
    const withOffer = orderVariant(ROT_ORDER, 'x').references.find(([l]) => l === 'Vårt offertnr');
    const standalone = orderVariant(BUSINESS_ORDER, 'x').references.find(([l]) => l === 'Vårt offertnr');
    expect(withOffer?.[1]).toBe('10152');
    expect(standalone?.[1]).toBe('');
  });

  it('följesedeln bär varken belopp, ROT eller betalningsvillkor', () => {
    const variant = deliveryNoteVariant(ROT_ORDER);
    expect(variant.showPrices).toBe(false);
    expect(variant.showRot).toBe(false);
    expect(variant.references.map(([label]) => label)).toEqual(['Er referens', 'Ert referensnr', 'Vår referens']);
  });
});

describe('ROT-uppgifternas plats på ordern', () => {
  it('villa: beteckningen flyttas till ROT-blocket och referensraden utgår', () => {
    const out = resolveOrderRotPresentation(ROT_DETAILS, true, 'Gustavsberg Sjöstugan 2:14');
    expect(out.referenceNumber).toBe('');
    expect(out.propertyNote).toBe('Fastighetsbeteckning: Gustavsberg Sjöstugan 2:14');
  });

  it('bostadsrätt: referensnumret bär märkningen och beteckningen kommer ur raderna', () => {
    const brf = { enabled: true, property_designation: 'Sundbyberg Ekbacken 3', brf_org_number: '769612-1234' };
    const out = resolveOrderRotPresentation(brf, true, 'Projekt 4711');
    expect(out.referenceNumber).toBe('Projekt 4711');
    expect(out.propertyNote).toBe('Fastighetsbeteckning: Sundbyberg Ekbacken 3  BRF org.nr: 769612-1234');
  });

  it('behåller BÅDA när referensnumret säger något annat än beteckningen', () => {
    // Beteckningen rättad i CRM efter en misslyckad header-synk, eller något ekonomi skrivit in för
    // hand i Fortnox. Hellre två gånger än att kundens egen märkning tyst försvinner.
    const out = resolveOrderRotPresentation(ROT_DETAILS, true, 'Gustavsberg Sjöstugan 2:15');
    expect(out.referenceNumber).toBe('Gustavsberg Sjöstugan 2:15');
    expect(out.propertyNote).toBe('Fastighetsbeteckning: Gustavsberg Sjöstugan 2:14');
  });

  it('rör ingenting på en order utan ROT', () => {
    const out = resolveOrderRotPresentation(null, false, 'Projekt 483089');
    expect(out.referenceNumber).toBe('Projekt 483089');
    expect(out.propertyNote).toBeNull();
  });
});

describe('orderbekräftelsen', () => {
  const render = (order = ROT_ORDER, extra: Record<string, unknown> = {}) => renderOrderPdfDesign({
    order,
    company: COMPANY,
    taxReductions: APPLICANTS,
    rotDetails: ROT_DETAILS,
    rotEnabled: true,
    logo: null,
    ...extra,
  });

  it('bär rubriken ORDERBEKRÄFTELSE och ordernumret', async () => {
    const text = (await pageText(await render())).join(' ');
    expect(text).toContain('ORDERBEKRÄFTELSE');
    expect(text).toContain('Ordernr');
    expect(text).toContain('113');
    expect(text).not.toContain('OFFERT');
  });

  it('skriver ut antalet — inte 0,00', async () => {
    // 🧨 Regressionsvakt för hela felklassen: orderraden bär OrderedQuantity, inte Quantity.
    const text = await pageText(await render());
    expect(text).toContain('15,00');
    expect(text.filter((line) => line === '0,00')).toEqual([]);
  });

  it('saknar Lev ant-kolumnen', async () => {
    // Fortnox mall har den; vi sätter alltid DeliveredQuantity = OrderedQuantity, så den hade visat
    // samma siffra två gånger (William 2026-09-07).
    expect((await pageText(await render())).join(' ')).not.toContain('LEV ANT');
  });

  it('VISAR ROT-avdraget, som Fortnox orderbekräftelse inte gör', async () => {
    // Facit (order 113) har "Totalt 12 250,00" och "Ordervärde 10 188,00" utan att mellanskillnaden
    // nämns någonstans. Vår summering förklarar den.
    const text = (await pageText(await render())).join(' ');
    expect(text).toContain('ROT-avdrag 30% av arbetskostnaden');
    expect(text).toContain('−2 062,00');
    expect(text).toContain('ATT BETALA EFTER AVDRAG');
    expect(text).toContain('10 188,00 SEK');
  });

  it('samlar sökandena och fastighetsbeteckningen i ROT-blocket', async () => {
    const text = (await pageText(await render())).join(' ');
    expect(text).toContain('ROT-AVDRAG');
    expect(text).toContain('Karin Lindqvist · 19740312-4519');
    expect(text).toContain('Erik Lindqvist · 19710918-2233');
    expect(text).toContain('Fastighetsbeteckning: Gustavsberg Sjöstugan 2:14');
  });

  it('skriver INTE beteckningen två gånger', async () => {
    const text = await pageText(await render());
    expect(text.filter((line) => line.includes('Gustavsberg Sjöstugan 2:14'))).toHaveLength(1);
  });

  it('säger TOTALT ORDERVÄRDE på en order utan avdrag', async () => {
    const text = (await pageText(await render(BUSINESS_ORDER, { taxReductions: [], rotDetails: null, rotEnabled: false }))).join(' ');
    expect(text).toContain('TOTALT ORDERVÄRDE');
    expect(text).toContain('12 250,00 SEK');
    expect(text).not.toContain('ROT-AVDRAG');
    // Företagskundens egen märkning står kvar i referensraden.
    expect(text).toContain('Projekt 483089');
  });
});

describe('följesedeln', () => {
  const render = (order = ROT_ORDER) => renderDeliveryNotePdf({
    order,
    company: COMPANY,
    taxReductions: APPLICANTS,
    rotDetails: ROT_DETAILS,
    rotEnabled: true,
    logo: null,
  });

  it('bär rubriken FÖLJESEDEL, artiklarna och antalet', async () => {
    const text = await pageText(await render());
    expect(text.join(' ')).toContain('FÖLJESEDEL');
    expect(text).toContain('2410509');
    expect(text).toContain('EKOVILLA cellulosa 0,038W/mK vind');
    expect(text).toContain('15,00');
    expect(text).toContain('M3');
  });

  it('bär INTE ett enda belopp', async () => {
    // Hela poängen med dokumentet. Den som kvitterar materialet på plats är inte nödvändigtvis den
    // som ska se vad jobbet kostar.
    const text = (await pageText(await render())).join(' ');
    // "Momsreg.nr" i foten är inte ett belopp — därför prövas summeringens egna etiketter, inte
    // ordet "moms".
    for (const forbidden of [
      'À-PRIS', 'SUMMA', 'RABATT', 'Summa exkl. moms', 'Moms 25%', 'Totalt inkl. moms',
      'ORDERVÄRDE', 'ATT BETALA', '220,00', '3 300,00', '12 250,00', '10 188,00',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('bär inget ROT — varken block, personnummer eller förbehåll', async () => {
    const text = (await pageText(await render())).join(' ');
    expect(text).not.toContain('ROT-AVDRAG');
    expect(text).not.toContain('19740312-4519');
    expect(text).not.toContain('Skatteverket');
  });

  it('behåller mätraden — den säger vad som ska levereras', async () => {
    expect(await pageText(await render())).toContain('Yta: 200 m², Tjocklek: 400 mm');
  });

  it('behåller leveransadressen', async () => {
    const text = (await pageText(await render())).join(' ');
    expect(text).toContain('LEVERANSADRESS');
    expect(text).toContain('Sjöstugevägen 4');
  });

  it('lämnar fastighetsbeteckningen kvar som textrad', async () => {
    // Utan ROT-block finns ingen plats att lyfta den till, så den ska stå kvar där Fortnox har
    // den — i det här fallet som orderns referensnummer.
    expect((await pageText(await render())).join(' ')).toContain('Gustavsberg Sjöstugan 2:14');
  });
});

// Skriver ut dokumenten att titta på:
//   ORDER_PDF_PREVIEW_DIR=/tmp/order npm test -- orderPdfDesign
it('skriver förhandsvisningar när ORDER_PDF_PREVIEW_DIR är satt', async () => {
  const dir = process.env.ORDER_PDF_PREVIEW_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });

  const base = { company: COMPANY, taxReductions: APPLICANTS, rotDetails: ROT_DETAILS, rotEnabled: true };
  const files: Array<[string, Uint8Array]> = [
    ['orderbekraftelse-rot.pdf', await renderOrderPdfDesign({ order: ROT_ORDER, ...base })],
    ['orderbekraftelse-foretag.pdf', await renderOrderPdfDesign({
      order: BUSINESS_ORDER, company: COMPANY, taxReductions: [], rotDetails: null, rotEnabled: false,
    })],
    ['foljesedel.pdf', await renderDeliveryNotePdf({ order: ROT_ORDER, ...base })],
  ];
  for (const [name, bytes] of files) await writeFile(path.join(dir, name), bytes);
  expect(files).toHaveLength(3);
});
