import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { assembleOfferDocument, offerAttachments, resolveTermsKind } from '@/lib/domains/fortnox/offerPdfAssembly';

/** Antalet bilder som ritas på en sida. Används för att bevisa att logotypen faktiskt kom med. */
async function countImages(bytes: Uint8Array, pageNumber = 1): Promise<number> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const ops = await (await doc.getPage(pageNumber)).getOperatorList();
  const paintImage = OPS.paintImageXObject;
  return ops.fnArray.filter((fn) => fn === paintImage).length;
}

/** Textraderna på en given sida i en renderad PDF — så sidbrytningen kan prövas på riktigt. */
async function extractPageText(bytes: Uint8Array, pageNumber: number): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  return content.items
    .map((item) => (item as { str?: string }).str ?? '')
    .map((str) => str.trim())
    .filter(Boolean);
}

import {
  buildSummaryBlock,
  cleanText,
  deliveryAddressLines,
  extractRotPropertyNote,
  formatDiscount,
  rotApplicantLines,
  wrapLines,
  groupHeight,
  groupOfferRows,
  renderOfferPdfDesign,
  loadDesignFonts,
  loadDesignLogo,
} from '@/lib/domains/fortnox/offerPdfDesign';
import type {
  FortnoxCompanySettingsResponse,
  FortnoxOfferResponse,
  FortnoxOfferRowResponse,
} from '@/lib/domains/fortnox/offerPdf';

// Textrad som Fortnox returnerar den: utan artikelnummer, utan belopp. Se `isTextOnlyRow`.
const note = (text: string): FortnoxOfferRowResponse => ({
  Description: text,
  Quantity: '0',
  Price: 0,
  Total: 0,
});

const article = (
  ArticleNumber: string,
  Description: string,
  Quantity: number,
  Unit: string,
  Price: number,
  VAT = 25,
): FortnoxOfferRowResponse => ({
  ArticleNumber,
  Description,
  Quantity,
  Unit,
  Price,
  Total: Quantity * Price,
  VAT,
});

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

describe('groupOfferRows', () => {
  it('hänger textraden på artikeln ovanför — mallens grå underrad', () => {
    const rows = [
      article('2410509', 'EKOVILLA cellulosa 0,038 W/mK vind', 80, 'm³', 370),
      note('Yta 200 m² · Tjocklek 400 mm'),
      article('1010', 'Etableringskostnad', 1, 'st', 2990),
    ];
    const groups = groupOfferRows(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].row?.ArticleNumber).toBe('2410509');
    expect(groups[0].notes).toEqual(['Yta 200 m² · Tjocklek 400 mm']);
    expect(groups[1].notes).toEqual([]);
  });

  it('samlar FLERA textrader under samma artikel', () => {
    const groups = groupOfferRows([
      article('2410603', 'Kantavstyvning vindsbjälklag', 42, 'm', 145),
      note('Plywood mot yttervägg'),
      note('Hela omkretsen'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].notes).toEqual(['Plywood mot yttervägg', 'Hela omkretsen']);
  });

  it('tappar ALDRIG en textrad som saknar artikel över sig', () => {
    // Utan egen grupp hade texten försvunnit tyst från ett kunddokument.
    const groups = groupOfferRows([note('Avser etapp 2'), article('1010', 'Etablering', 1, 'st', 2990)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].row).toBeNull();
    expect(groups[0].notes).toEqual(['Avser etapp 2']);
  });

  it('hoppar över en tom textrad i stället för att rita en osynlig underrad', () => {
    expect(groupOfferRows([article('1010', 'Etablering', 1, 'st', 2990), note('   ')])[0].notes).toEqual([]);
  });
});

describe('groupHeight', () => {
  // Måtten är lästa ur Figma-exporten: 31 pt med underrad, 23 pt utan. Går de isär från
  // `drawRowGroup` bryter sidan på fel ställe och sista raden hamnar under foten.
  it('matchar mallens uppmätta radhöjder', () => {
    expect(groupHeight(true, 1, 1)).toBe(31);
    expect(groupHeight(true, 1, 0)).toBe(23);
  });

  it('växer med varje ombruten benämnings- och anmärkningsrad', () => {
    expect(groupHeight(true, 2, 1)).toBe(41);
    expect(groupHeight(true, 1, 2)).toBe(41);
  });

  it('knuffar INTE ned en fristående anmärkning ett radsteg — den är radens första text', () => {
    expect(groupHeight(false, 0, 1)).toBe(19);
  });
});

describe('rotApplicantLines', () => {
  it('ger ett namn med personnummer per sökande', () => {
    expect(
      rotApplicantLines([
        { CustomerName: 'Karin Lindqvist', SocialSecurityNumber: '19740312-4519' },
        { CustomerName: 'Erik Lindqvist', SocialSecurityNumber: '19710918-2233' },
      ]),
    ).toEqual(['Karin Lindqvist · 19740312-4519', 'Erik Lindqvist · 19710918-2233']);
  });

  it('DELAR ALDRIG ut något belopp per sökande — Fortnox ger ingen sådan siffra', () => {
    const lines = rotApplicantLines([
      { CustomerName: 'Karin Lindqvist', SocialSecurityNumber: '19740312-4519' },
      { CustomerName: 'Erik Lindqvist', SocialSecurityNumber: '19710918-2233' },
    ]);
    expect(lines.join(' ')).not.toMatch(/\d[\d ]*,\d\d/);
  });

  it('utelämnar personnumret när det saknas i stället för ett tomt parentespar', () => {
    expect(rotApplicantLines([{ CustomerName: 'Kim Wolke', SocialSecurityNumber: null }]))
      .toEqual(['Kim Wolke']);
  });

  it('ger inga rader alls utan sökande', () => {
    expect(rotApplicantLines([])).toEqual([]);
  });
});

describe('extractRotPropertyNote', () => {
  const etablering = article('1010', 'Etableringskostnad', 1, 'st', 2990);

  it('lyfter fastighetsraden ur radlistan', () => {
    const result = extractRotPropertyNote([etablering, note('Fastighetsbeteckning: Huddinge Basvägen 2:14')]);
    expect(result.note).toBe('Fastighetsbeteckning: Huddinge Basvägen 2:14');
    expect(result.rows).toEqual([etablering]);
  });

  it('behåller BRF-numret som står på samma rad', () => {
    const result = extractRotPropertyNote([
      etablering,
      note('Fastighetsbeteckning: Huddinge Basvägen 2:14  BRF org.nr: 769612-3456'),
    ]);
    expect(result.note).toBe('Fastighetsbeteckning: Huddinge Basvägen 2:14  BRF org.nr: 769612-3456');
  });

  it('BEVARAR säljarens radtext när noten slagits ihop med den', () => {
    // appendFortnoxTextNote slår ihop noten med en textrad som redan ligger sist. Lyfts hela raden
    // följer säljarens egen text med och försvinner från sin artikel.
    const result = extractRotPropertyNote([
      etablering,
      note('Arbetet utförs i två etapper  Fastighetsbeteckning: Huddinge Basvägen 2:14'),
    ]);
    expect(result.note).toBe('Fastighetsbeteckning: Huddinge Basvägen 2:14');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].Description).toBe('Arbetet utförs i två etapper');
  });

  it('rör inte en ARTIKELRAD som råkar nämna fastighetsbeteckningen', () => {
    const priced = article('2410509', 'Fastighetsbeteckning: kontroll', 1, 'st', 500);
    const result = extractRotPropertyNote([priced]);
    expect(result.note).toBeNull();
    expect(result.rows).toEqual([priced]);
  });

  it('lämnar radlistan orörd på en offert utan fastighetsbeteckning', () => {
    const rows = [etablering, note('Yta 200 m²')];
    expect(extractRotPropertyNote(rows)).toEqual({ note: null, rows });
  });

  it('tappar INTE den första när två rader bär beteckningen', () => {
    // Skrev vi över noten vid den andra träffen försvann den första helt ur dokumentet — varken
    // kvar som rad eller utskriven i ROT-blocket.
    const result = extractRotPropertyNote([
      etablering,
      note('Fastighetsbeteckning: Huddinge Basvägen 2:14'),
      note('Fastighetsbeteckning: Huddinge Basvägen 2:15'),
    ]);
    expect(result.note).toBe('Fastighetsbeteckning: Huddinge Basvägen 2:14');
    expect(result.rows.map((r) => r.Description)).toContain('Fastighetsbeteckning: Huddinge Basvägen 2:15');
  });
});

describe('formatDiscount', () => {
  const row = (Discount: number | null, DiscountType?: string): FortnoxOfferRowResponse => ({
    ArticleNumber: '1010',
    Description: 'Etablering',
    Quantity: 1,
    Price: 1000,
    Total: 750,
    Discount,
    DiscountType,
  });

  it('skriver procenten svenskt och utan onödiga decimaler', () => {
    expect(formatDiscount(row(25, 'PERCENT'))).toBe('25 %');
    expect(formatDiscount(row(12.5, 'PERCENT'))).toBe('12,5 %');
    expect(formatDiscount(row(7.25, 'PERCENT'))).toBe('7,25 %');
    expect(formatDiscount(row(100, 'PERCENT'))).toBe('100 %');
  });

  it('visar kronrabatten som belopp när Fortnox säger AMOUNT', () => {
    // CRM:et skickar alltid PERCENT, men en rad kan ha redigerats i Fortnox.
    expect(formatDiscount(row(250, 'AMOUNT'))).toBe('250,00');
  });

  it('tiger på en rad utan rabatt — kolumnen ska inte fyllas med nollor', () => {
    expect(formatDiscount(row(0, 'PERCENT'))).toBe('');
    expect(formatDiscount(row(null))).toBe('');
  });
});

describe('deliveryAddressLines', () => {
  const invoice = { Address1: 'Sjöängsvägen 15', ZipCode: '19272', City: 'Sollentuna' };

  it('visar leveransadressen när den skiljer sig från fakturaadressen', () => {
    expect(
      deliveryAddressLines({
        ...invoice,
        DeliveryAddress1: 'Verkstadsvägen 8',
        DeliveryZipCode: '19540',
        DeliveryCity: 'Märsta',
      }),
    ).toEqual(['Verkstadsvägen 8', '19540 Märsta']);
  });

  it('tiger när leveransadressen ÄR fakturaadressen — samma adress två gånger är brus', () => {
    expect(
      deliveryAddressLines({
        ...invoice,
        DeliveryAddress1: 'Sjöängsvägen 15',
        DeliveryZipCode: '19272',
        DeliveryCity: 'Sollentuna',
      }),
    ).toEqual([]);
  });

  it('visar den när BARA orten skiljer — annars åker arbetslaget till fel ort', () => {
    // Att jämföra enbart gatan hade dolt den här: samma gatunamn finns i båda orterna.
    expect(
      deliveryAddressLines({
        ...invoice,
        DeliveryAddress1: 'Sjöängsvägen 15',
        DeliveryZipCode: '80251',
        DeliveryCity: 'Gävle',
      }),
    ).toEqual(['Sjöängsvägen 15', '80251 Gävle']);
  });

  it('ger inga rader alls när leveransadressen saknas', () => {
    expect(deliveryAddressLines(invoice)).toEqual([]);
  });
});

describe('buildSummaryBlock', () => {
  const base: FortnoxOfferResponse = {
    Net: 44820,
    TotalVAT: 0,
    Total: 44820,
    TotalToPay: 44820,
  };

  it('visar BARA summan exkl. moms vid omvänd skattskyldighet', () => {
    // Ingen "Totalt inkl. moms" som upprepar samma tal — så ritar mallen den offerten.
    const block = buildSummaryBlock(base, []);
    expect(block.rows).toEqual([{ label: 'Summa exkl. moms', value: '44 820,00' }]);
    expect(block.deduction).toBeNull();
    expect(block.total).toEqual({ label: 'TOTALT OFFERTVÄRDE', value: '44 820,00 SEK' });
  });

  it('räknar upp moms och totalsumma när momsen finns', () => {
    const rows = [article('1010', 'Etablering', 1, 'st', 18200, 25)];
    const block = buildSummaryBlock({ ...base, Net: 18200, TotalVAT: 4550, Total: 22750, TotalToPay: 22750 }, rows);
    expect(block.rows.map((r) => r.label)).toEqual(['Summa exkl. moms', 'Moms 25%', 'Totalt inkl. moms']);
    expect(block.rows[1].value).toBe('4 550,00');
  });

  it('DELAR ALDRIG momsen mellan flera skattesatser — det vore vår egen avrundning', () => {
    const rows = [
      article('a', 'Tjänst', 1, 'st', 10000, 25),
      article('b', 'Vara', 1, 'st', 1000, 12),
    ];
    const block = buildSummaryBlock({ ...base, Net: 11000, TotalVAT: 2620, Total: 13620, TotalToPay: 13620 }, rows);
    expect(block.rows.map((r) => r.label)).toEqual(['Summa exkl. moms', 'Moms', 'Totalt inkl. moms']);
    expect(block.rows[1].value).toBe('2 620,00');
  });

  it('tar med öresavrundningen FÖRE totalen, annars går summeringen inte ihop på papperet', () => {
    const block = buildSummaryBlock(
      { ...base, Net: 18200, TotalVAT: 4550, RoundOff: 0.5, Total: 22750.5, TotalToPay: 22750.5 },
      [article('1010', 'Etablering', 1, 'st', 18200, 25)],
    );
    expect(block.rows.map((r) => r.label)).toEqual([
      'Summa exkl. moms',
      'Moms 25%',
      'Öresavrundning',
      'Totalt inkl. moms',
    ]);
  });

  it('visar avdraget även när skattereduktionen INTE är ROT — annars går summan inte ihop', () => {
    // TotalToPay är redan minskad med reduktionen, vilken sort den än är. Utan raden vore
    // slutsumman lägre än "Totalt inkl. moms" utan att något förklarar mellanskillnaden.
    const block = buildSummaryBlock(
      { ...base, Net: 18200, TotalVAT: 4550, Total: 22750, TaxReduction: 3937, TaxReductionType: 'rut', TotalToPay: 18813 },
      [article('1010', 'Etablering', 1, 'st', 18200, 25)],
    );
    expect(block.deduction).toEqual({ label: 'Skattereduktion', value: '−3 937,00' });
    expect(block.total.label).toBe('ATT BETALA EFTER AVDRAG');
  });

  it('hittar ALDRIG på en procentsats för en sort vi inte känner', () => {
    const block = buildSummaryBlock({ ...base, TaxReduction: 1000, TaxReductionType: 'green' }, []);
    expect(block.deduction?.label).toBe('Skattereduktion');
  });

  it('lägger ROT-avdraget för sig med RIKTIGT minustecken och byter rutans etikett', () => {
    const block = buildSummaryBlock(
      {
        ...base,
        Net: 18200,
        TotalVAT: 4550,
        Total: 22750,
        TaxReduction: 3937,
        TaxReductionType: 'rot',
        TotalToPay: 18813,
      },
      [article('1010', 'Etablering', 1, 'st', 18200, 25)],
    );
    expect(block.deduction).toEqual({ label: 'ROT-avdrag 30% av arbetskostnaden', value: '−3 937,00' });
    expect(block.total).toEqual({ label: 'ATT BETALA EFTER AVDRAG', value: '18 813,00 SEK' });
  });

  it('lämnar avdraget ute på ett dokument utan ROT, även om typen står kvar', () => {
    expect(buildSummaryBlock({ ...base, TaxReductionType: 'rot', TaxReduction: 0 }, []).deduction).toBeNull();
  });
});

describe('wrapLines', () => {
  it('BRYTER ett ord som ensamt är bredare än kolumnen', async () => {
    // Ett obrutet ord som inte får plats sköts tidigare ut som egen rad och skrev över
    // antals- och prissiffrorna till höger om benämningskolumnen.
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont((await loadDesignFonts()).regular, { subset: true });
    const width = 60;

    const lines = wrapLines('Isoleringsentreprenadberedningsunderlag', font, 8, width);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 8)).toBeLessThanOrEqual(width);
  });

  it('bryter fortfarande mellan ord i vanliga fall', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont((await loadDesignFonts()).regular, { subset: true });
    expect(wrapLines('Plywood mot yttervägg, hela omkretsen', font, 7.5, 200)).toEqual([
      'Plywood mot yttervägg, hela omkretsen',
    ]);
  });
});

describe('cleanText', () => {
  // Open Sans är inbäddad, så tecknen nedan behöver INTE längre vikas till ASCII som `pdfSafe` gör.
  it('behåller minustecken, upphöjda siffror och svenska tecken', () => {
    expect(cleanText('−3 937,00 · m² · Höjdmarkeringar')).toBe('−3 937,00 · m² · Höjdmarkeringar');
  });

  it('städar bort styrtecken men BEVARAR radbrytningen', () => {
    expect(cleanText('Rad ett\nRad två')).toBe('Rad ett\nRad två');
  });
});

describe('renderOfferPdfDesign', () => {
  const STANDARD: FortnoxOfferResponse = {
    DocumentNumber: '10151',
    OfferDate: '2026-09-02',
    ExpireDate: '2026-10-02',
    CustomerNumber: '707906729',
    CustomerName: 'Byggaktiebolaget Sevandersson & Hallgren',
    Address1: 'Sjöängsvägen 15',
    ZipCode: '19272',
    City: 'Sollentuna',
    DeliveryAddress1: 'Verkstadsvägen 8',
    DeliveryZipCode: '19540',
    DeliveryCity: 'Märsta',
    YourReference: 'Jan Hallgren',
    YourReferenceNumber: 'Vindsisolering Verkstad Sollentuna',
    OurReference: 'Marcus Huld',
    TermsOfPayment: '10',
    Currency: 'SEK',
    Net: 44820,
    TotalVAT: 0,
    Total: 44820,
    TotalToPay: 44820,
    OfferRows: [
      article('2410509', 'EKOVILLA cellulosa 0,038 W/mK vind', 80, 'm³', 370, 0),
      note('Yta 200 m² · Tjocklek 400 mm'),
      article('2410603', 'Kantavstyvning vindsbjälklag', 42, 'm', 145, 0),
      note('Plywood mot yttervägg, hela omkretsen'),
      article('2410710', 'Gångbrygga över isolering', 12, 'm', 320, 0),
      note('Bredd 600 mm, från vindslucka till gavel'),
      // Rabatterad rad: 2 000,00 − 7,5 % = 1 850,00. Fortnox Total är redan rabatterad, så
      // offertsumman är oförändrad — rabattkolumnen är enbart upplysning.
      { ...article('2410805', 'Isolerad vindslucka, byte och montage', 1, 'st', 2000, 0), Discount: 7.5, DiscountType: 'PERCENT', Total: 1850 },
      article('2410920', 'Höjdmarkeringar och skyltning', 1, 'st', 450, 0),
      note('Enligt Behörig Lösull'),
      article('1010', 'Etableringskostnad', 1, 'st', 2990, 0),
    ],
  };

  const ROT: FortnoxOfferResponse = {
    ...STANDARD,
    DocumentNumber: '10129',
    OfferDate: '2026-08-28',
    ExpireDate: '2026-09-27',
    // Påhittad privatperson. Skarpa ROT-kunder hör inte hemma i en committad fixtur.
    CustomerNumber: '707906715',
    CustomerName: 'Karin Lindqvist',
    Address1: 'Backstigen 12',
    ZipCode: '141 38',
    City: 'Huddinge',
    // ROT-jobbet sitter på fritidshuset, inte på fakturaadressen — det vanliga fallet där
    // leveransadressen faktiskt betyder något.
    DeliveryAddress1: 'Sjöstugevägen 4',
    DeliveryZipCode: '134 41',
    DeliveryCity: 'Gustavsberg',
    YourReference: 'Karin Lindqvist',
    YourReferenceNumber: 'Tilläggsisolering av befintlig vind',
    OurReference: 'Tony Bejedal',
    Net: 18200,
    TotalVAT: 4550,
    Total: 22750,
    TaxReduction: 3937,
    TaxReductionType: 'rot',
    TotalToPay: 18813,
    OfferRows: [
      article('2410509', 'EKOVILLA cellulosa 0,038 W/mK vind', 10, 'm³', 370),
      note('Yta 25 m² · Tjocklek 400 mm'),
      article('2410710', 'Gångbrygga över isolering', 5, 'm', 320),
      article('1010', 'Etableringskostnad', 1, 'st', 2400),
      article('10058', 'Arbetskostnad ROT', 1, 'st', 10500),
      note('Installation lösull, ROT-berättigad arbetskostnad'),
      // Fastighetsbeteckningen kommer alltid sist, som textrad — Fortnox har inget fält för den.
      note('Fastighetsbeteckning: Gustavsberg Sjöstugan 2:14'),
    ],
  };

  // Två sökande: paret som äger huset ihop. Beloppet delas aldrig mellan dem.
  const ROT_APPLICANTS = [
    { CustomerName: 'Karin Lindqvist', SocialSecurityNumber: '19740312-4519' },
    { CustomerName: 'Erik Lindqvist', SocialSecurityNumber: '19710918-2233' },
  ];

  // Fyrtio rader tvingar fram sidbrytning. Var femte bär rabatt, så RABATT-kolumnen syns på ALLA
  // sidor — kolumnen bestäms en gång för dokumentet, och det är just det som ska gå att se.
  const manyRows = (): FortnoxOfferRowResponse[] =>
    Array.from({ length: 40 }, (_, i) => {
      const row = article(`24105${i}`, `Isolering etapp ${i + 1}`, 4, 'm³', 370, 0);
      return i % 5 === 4 ? { ...row, Discount: 10, DiscountType: 'PERCENT', Total: 1332 } : row;
    });

  const render = async (offer: FortnoxOfferResponse, vat?: string) =>
    renderOfferPdfDesign({
      offer,
      company: COMPANY,
      customerVatNumber: vat ?? null,
      taxReductions: offer.TaxReductionType === 'rot' ? ROT_APPLICANTS : [],
      logo: await loadDesignLogo(),
      fonts: await loadDesignFonts(),
    });

  it('renderar standardofferten till en giltig PDF', async () => {
    const bytes = await render(STANDARD, 'SE556948642501');
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it('renderar ROT-offerten med moms och avdrag', async () => {
    const bytes = await render(ROT);
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('sätter båda sökandena och fastighetsbeteckningen i ROT-blocket, inte i radlistan', async () => {
    const text = (await extractPageText(await render(ROT), 1)).join(' ');
    expect(text).toContain('ROT-AVDRAG');
    expect(text).toContain('19740312-4519');
    expect(text).toContain('19710918-2233');
    expect(text).toContain('Fastighetsbeteckning: Gustavsberg Sjöstugan 2:14');
    // Förbehållet står bredvid beloppet det gäller.
    expect(text).toContain('Skatteverket');
  });

  it('håller ROT-uppgifterna borta från en offert UTAN avdrag', async () => {
    // Sökandelistan får aldrig läcka in på ett dokument som inte bär ROT — då hade ett personnummer
    // stått på en företagsoffert.
    const text = (await extractPageText(await render(STANDARD, 'SE556948642501'), 1)).join(' ');
    expect(text).not.toContain('ROT-AVDRAG');
    expect(text).not.toContain('19740312-4519');
    expect(text).not.toContain('Skatteverket');
  });

  it('bryter till flera sidor när raderna inte får plats', async () => {
    const bytes = await render({ ...STANDARD, OfferRows: manyRows() });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('ritar företagsfoten på VARJE sida, inte bara den sista', async () => {
    // Sidorna ska vara identiska så när som på priset. Foten ritades tidigare en gång, efter
    // radloopen, så sida ett saknade både företagsuppgifter och avgränsande linje.
    const bytes = await render({ ...STANDARD, OfferRows: manyRows() });
    const doc = await PDFDocument.load(bytes);
    for (let p = 1; p <= doc.getPageCount(); p++) {
      const text = await extractPageText(bytes, p);
      expect(text, `sida ${p}`).toContain('EKOVILLA se AB');
      expect(text, `sida ${p}`).toContain('Godkänd för F-skatt');
    }
  });

  it('håller ROT-blocket borta när Fortnox tappat avdraget men radtexten ligger kvar', async () => {
    // Glidningen offers.ts varnar för: ROT valt i CRM, men dokumentet i Fortnox är inte ROT.
    // Fastighetsraden ska då stanna som vanlig textrad, inte ge en ensam ROT-rubrik utan avdrag.
    const drifted = { ...ROT, TaxReductionType: null, TaxReduction: 0, TotalToPay: 22750 };
    const text = (await extractPageText(await render(drifted), 1)).join(' ');
    expect(text).not.toContain('ROT-AVDRAG');
    expect(text).toContain('Fastighetsbeteckning: Gustavsberg Sjöstugan 2:14');
  });

  it('lämnar ALDRIG en sista sida med bara totalbeloppet på', async () => {
    // Raderna fick tidigare fylla sidan och trängde ut summeringen till en egen, i praktiken tom,
    // sista sida. Summeringens yta reserveras därför på varje sida.
    const bytes = await render({ ...STANDARD, OfferRows: manyRows() });
    const doc = await PDFDocument.load(bytes);
    const last = await extractPageText(bytes, doc.getPageCount());
    expect(last.some((line) => line.startsWith('Isolering etapp'))).toBe(true);
  });

  it('hämtar logotypen SJÄLV när anroparen inte skickar in den', async () => {
    // Regression: inkopplingen i offers.ts anropade renderaren utan `logo`, och då kom offerten ut
    // utan logotyp. Testerna skickade alltid in den och missade det. Nu hämtas den från disk.
    const bytes = await renderOfferPdfDesign({ offer: STANDARD, company: COMPANY });
    expect(await countImages(bytes)).toBeGreaterThan(0);
  });

  it('respekterar ett uttryckligt "ingen logotyp"', async () => {
    const bytes = await renderOfferPdfDesign({ offer: STANDARD, company: COMPANY, logo: null });
    expect(await countImages(bytes)).toBe(0);
  });

  it('renderar även när Fortnox-svaret är magert — inga rader, inga referenser', async () => {
    const bytes = await render({ DocumentNumber: '1', Net: 0, Total: 0, TotalToPay: 0 });
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  // Skriver ut mallarna att jämföra mot Figma-exporten. Körs bara när sökvägen är satt:
  //   OFFER_PDF_PREVIEW_DIR=/tmp/offert npm test -- offerPdfDesign
  //
  // Peka dessutom OFFER_PDF_PREVIEW_FIXTURE på en JSON-fil — { offer, company?, customerVatNumber? }
  // med ett riktigt Fortnox-svar — så renderas den också. SKARP KUNDDATA HÖR HEMMA DÄR, i en fil
  // utanför repot, aldrig i fixturerna nedan: de committas och skulle bära namn och adress vidare
  // i git-historiken för alltid.
  it('skriver förhandsvisningar när OFFER_PDF_PREVIEW_DIR är satt', async () => {
    const dir = process.env.OFFER_PDF_PREVIEW_DIR;
    if (!dir) return;
    await mkdir(dir, { recursive: true });

    const fixturePath = process.env.OFFER_PDF_PREVIEW_FIXTURE;
    if (fixturePath) {
      const raw = JSON.parse(await readFile(fixturePath, 'utf8')) as {
        offer: FortnoxOfferResponse;
        company?: FortnoxCompanySettingsResponse;
        customerVatNumber?: string | null;
      };
      const bytes = await renderOfferPdfDesign({
        offer: raw.offer,
        company: raw.company ?? COMPANY,
        customerVatNumber: raw.customerVatNumber ?? null,
        logo: await loadDesignLogo(),
        fonts: await loadDesignFonts(),
      });
      await writeFile(path.join(dir, 'offert-verklig.pdf'), bytes);
    }

    // Hela dokumentet med bilagorna runt. Bara villkoren finns i repot än — försättsbladet och
    // informationsbladet hoppas över med en varning, precis som de ska tills filerna läggs in.
    const rotBytes = await render(ROT);
    const komplett = await assembleOfferDocument(rotBytes, offerAttachments(resolveTermsKind({ quote_type: 'private' })));
    await writeFile(path.join(dir, 'offert-komplett.pdf'), komplett);

    const many = manyRows();
    const files: Array<[string, Uint8Array]> = [
      ['offert-standard.pdf', await render(STANDARD, 'SE556948642501')],
      ['offert-rot.pdf', await render(ROT)],
      ['offert-flersidig.pdf', await render({ ...STANDARD, OfferRows: many }, 'SE556948642501')],
    ];
    for (const [name, bytes] of files) await writeFile(path.join(dir, name), bytes);
    expect(files).toHaveLength(3);
  });
});
