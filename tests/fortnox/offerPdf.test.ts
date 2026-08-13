import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  buildTaxReductionLine,
  formatAmount,
  formatQuantity,
  isTextOnlyRow,
  pdfSafe,
  renderOfferPdf,
  shouldRenderLocally,
  summarizeVat,
  type FortnoxOfferResponse,
} from '@/lib/domains/fortnox/offerPdf';

// Riktig data från offert #10008 i Fortnox (avläst via API:t 2026-08-13). Används som fixtur så
// testerna mäter mot ett dokument som faktiskt existerat, inte mot påhittade tal — det är just
// summeringen och ROT-raden som måste stämma mot vad Fortnox sedan fakturerar.
const OFFER_10008: FortnoxOfferResponse = {
  DocumentNumber: '10008',
  OfferDate: '2026-08-12',
  ExpireDate: '2026-09-11',
  CustomerNumber: '707906659',
  CustomerName: 'Kim Wolke',
  OurReference: 'Marcus Huld',
  YourReference: 'Kim',
  TermsOfPayment: '10',
  Currency: 'SEK',
  Net: 27867.8,
  TotalVAT: 6966.95,
  RoundOff: 0.25,
  Total: 34835,
  TotalToPay: 29960,
  TaxReduction: 4875,
  TaxReductionType: 'rot',
  OfferRows: [
    { ArticleNumber: '2410510', Description: 'EKOVILLA cellulosa 0,038W/mK snedtak', Quantity: '20.79', Unit: 'M3', Price: 420, Total: 8731.8, VAT: 25 },
    { ArticleNumber: null, Description: 'Yta: 66 m², Tjocklek: 315 mm', Quantity: '0', Price: 0, Total: 0, VAT: 25 },
    { ArticleNumber: '2410511', Description: 'EKOVILLA cellulosa 0,038W/mK vägg', Quantity: '9.52', Unit: 'M3', Price: 550, Total: 5236, VAT: 25 },
    { ArticleNumber: null, Description: 'Yta: 56 m², Tjocklek: 170 mm', Quantity: '0', Price: 0, Total: 0, VAT: 25 },
    { ArticleNumber: '1010', Description: 'Etableringskostnad', Quantity: '1', Unit: 'st', Price: 900, Total: 900, VAT: 25 },
    { ArticleNumber: '10058', Description: 'Arbetskostnad ROT', Quantity: '1', Price: 13000, Total: 13000, VAT: 25 },
  ],
};

const COMPANY = {
  Name: 'EKOVILLA se AB', Address: 'Celebra AB, Box 44', ZipCode: '81121', City: 'SANDVIKEN',
  Country: 'Sverige', Phone1: '020-446640', Email: 'info@ekovilla.se', WWW: 'www.ekovilla.se',
  BG: '541-0469', IBAN: 'SE3912000000012400129770', BIC: 'DABASESX',
  OrganizationNumber: '559341-9673', VATNumber: 'SE559341967301', Domicile: 'SANDVIKEN',
};

describe('shouldRenderLocally', () => {
  it('renderar i ROT-läget bara när BÅDA villkoren är sanna', () => {
    expect(shouldRenderLocally('rot', true, 'rot')).toBe(true);
    // Säljaren valde ROT men Fortnox räknar inte dokumentet som ROT — då är det inte det trasiga
    // fallet, och Fortnox mall ska fortsätta gälla.
    expect(shouldRenderLocally('rot', true, 'none')).toBe(false);
    expect(shouldRenderLocally('rot', true, null)).toBe(false);
    // ROT-dokument i Fortnox men väljaren av i CRM — samma sak åt andra hållet.
    expect(shouldRenderLocally('rot', false, 'rot')).toBe(false);
    expect(shouldRenderLocally('rot', false, 'none')).toBe(false);
  });

  it('tar över ALLA offerter i "all"-läget — det är bytet när egen formgivning är klar', () => {
    expect(shouldRenderLocally('all', false, 'none')).toBe(true);
    expect(shouldRenderLocally('all', true, 'rot')).toBe(true);
    expect(shouldRenderLocally('all', false, null)).toBe(true);
  });

  it('lämnar allt till Fortnox i "off"-läget, även ett ROT-dokument', () => {
    // Nödbromsen måste gälla utan undantag, annars går den inte att lita på.
    expect(shouldRenderLocally('off', true, 'rot')).toBe(false);
    expect(shouldRenderLocally('off', false, 'none')).toBe(false);
  });
});

describe('formatAmount', () => {
  it('formaterar svenskt: mellanslag som tusental, komma som decimal, alltid två decimaler', () => {
    expect(formatAmount(27867.8)).toBe('27 867,80');
    expect(formatAmount(0.25)).toBe('0,25');
    expect(formatAmount(1000000)).toBe('1 000 000,00');
    expect(formatAmount(900)).toBe('900,00');
  });

  it('behandlar saknade och ogiltiga värden som noll i stället för att skriva NaN på ett kunddokument', () => {
    expect(formatAmount(null)).toBe('0,00');
    expect(formatAmount(undefined)).toBe('0,00');
    expect(formatAmount(Number.NaN)).toBe('0,00');
  });

  it('sätter minustecknet före tusentalsgrupperingen', () => {
    expect(formatAmount(-1234.5)).toBe('-1 234,50');
  });
});

describe('formatQuantity', () => {
  it('visar två decimaler som Fortnox mall gör', () => {
    expect(formatQuantity('20.79')).toBe('20,79');
    expect(formatQuantity('1')).toBe('1,00');
    expect(formatQuantity(47.5)).toBe('47,50');
  });
});

describe('isTextOnlyRow', () => {
  it('känner igen textraden (mätning/Radtext) som saknar artikelnummer och belopp', () => {
    expect(isTextOnlyRow({ ArticleNumber: null, Description: 'Yta: 66 m²', Quantity: '0', Price: 0, Total: 0 })).toBe(true);
  });

  it('räknar INTE en prissatt rad som textrad, ens utan artikelnummer', () => {
    // En fritt inskriven rad utan artikel har fortfarande pris och ska ha sina siffror utskrivna.
    expect(isTextOnlyRow({ ArticleNumber: null, Description: 'Övrigt', Quantity: '1', Price: 500, Total: 500 })).toBe(false);
  });

  it('räknar aldrig en rad med artikelnummer som textrad', () => {
    expect(isTextOnlyRow({ ArticleNumber: '1010', Description: 'Etablering', Quantity: '0', Price: 0, Total: 0 })).toBe(false);
  });
});

describe('buildTaxReductionLine', () => {
  it('skriver namn, personnummer och belopp', () => {
    expect(buildTaxReductionLine({ CustomerName: 'Rasmus Eklund', SocialSecurityNumber: '19920926-1230' }, 5821))
      .toBe('Rasmus Eklund (19920926-1230) - 5 821,00 SEK');
  });

  it('utelämnar parentesen när personnumret saknas — Fortnox skriver ut ett tomt "()"', () => {
    // Numret krävs först vid orderskapandet, så en offert utan det är ett normalfall och ska inte
    // se trasig ut för kunden.
    expect(buildTaxReductionLine({ CustomerName: 'Kim Wolke', SocialSecurityNumber: '' }, 4875))
      .toBe('Kim Wolke - 4 875,00 SEK');
  });
});

describe('summarizeVat', () => {
  it('summerar underlag per skattesats och hoppar över textrader', () => {
    const [only] = summarizeVat(OFFER_10008.OfferRows!);
    expect(only.rate).toBe(25);
    // 8731.80 + 5236 + 900 + 13000 — textraderna får inte räknas med.
    expect(only.base).toBeCloseTo(27867.8, 2);
    expect(only.vat).toBeCloseTo(6966.95, 2);
  });

  it('håller isär flera skattesatser', () => {
    const summary = summarizeVat([
      { Total: 100, VAT: 25 },
      { Total: 200, VAT: 12 },
      { Total: 100, VAT: 25 },
    ]);
    expect(summary).toEqual([
      { rate: 25, base: 200, vat: 50 },
      { rate: 12, base: 200, vat: 24 },
    ]);
  });
});

describe('pdfSafe', () => {
  it('behåller svenska tecken och m² — de ligger inom WinAnsi', () => {
    expect(pdfSafe('Yta: 66 m², Tjocklek: 315 mm')).toBe('Yta: 66 m², Tjocklek: 315 mm');
    expect(pdfSafe('Förhöjd råspont åäö ÅÄÖ')).toBe('Förhöjd råspont åäö ÅÄÖ');
  });

  it('översätter tecken som annars får pdf-lib att kasta', () => {
    // Ett tankstreck i en artikelbenämning skulle annars göra hela offerten till ett 500-svar.
    expect(pdfSafe('Ekovilla — lösull')).toBe('Ekovilla - lösull');
    expect(pdfSafe('”citat” och ’apostrof’')).toBe('"citat" och \'apostrof\'');
  });
});

describe('renderOfferPdf', () => {
  it('renderar offert 10008 till en giltig PDF', async () => {
    const bytes = await renderOfferPdf({
      offer: OFFER_10008,
      taxReductions: [{ CustomerName: 'Kim Wolke', SocialSecurityNumber: '' }],
      company: COMPANY,
      logo: null,
    });

    expect(bytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('renderar även när Fortnox-svaret är magert — inga rader, inga referenser', async () => {
    // Ett tomt dokument får inte krascha PDF-routen; säljaren ska se en offert, inte ett 500.
    const bytes = await renderOfferPdf({
      offer: { DocumentNumber: '1', TaxReductionType: 'rot', OfferRows: [] },
      taxReductions: [],
      company: {},
      logo: null,
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('sidbryter en offert med många rader i stället för att skriva över foten', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ArticleNumber: `24105${i}`, Description: `Rad ${i} med en ganska lång benämning som tvingar radbrytning`,
      Quantity: '1', Unit: 'M3', Price: 100, Total: 100, VAT: 25,
    }));
    const bytes = await renderOfferPdf({
      offer: { ...OFFER_10008, OfferRows: many },
      taxReductions: [{ CustomerName: 'Kim Wolke', SocialSecurityNumber: '19850101-1236' }],
      company: COMPANY,
      logo: null,
    });
    // Läs tillbaka dokumentet och räkna sidorna på riktigt — pdf-lib komprimerar
    // objektströmmarna, så en textsökning efter /Type /Page hittar ingenting.
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBeGreaterThan(1);
  });
});
