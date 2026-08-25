import { describe, it, expect } from 'vitest';
import {
  buildMeasurementLines,
  hasMeasurementBlock,
  replaceMeasurementBlock,
  regenerateMeasurementBlock,
  stripMeasurementBlock,
} from '@/lib/domains/crm/measurementBlock';

// Måttblocket blir arbetsbeskrivningen installatören bygger efter. Två ytor matar det:
// offertformuläret fyller i det AUTOMATISKT medan raderna skrivs, arbetsordern hämtar om det
// på klick när artiklar rättats i efterhand. Automatiken kör på varje tangenttryckning i
// måttfälten, vilket gör ersättningsreglerna skarpa — en trasig ersättning staplar dubbletter
// eller fryser gamla mått i stället för att synas en gång.

describe('måttblocket', () => {
  it('buildMeasurementLines: m³-rader med mått → "Label – m² × mm", övriga ignoreras', () => {
    const lines = buildMeasurementLines([
      { pricing_mode: 'm3', construction: 'vagg', m2: '100', thickness_mm: '200' },
      { pricing_mode: 'm3', construction: 'snedtak', m2: '50', thickness_mm: '300', article_name: 'Snedtaksisolering' },
      { pricing_mode: 'm3', article_name: 'Vindsisolering', construction: '', m2: '80', thickness_mm: '400' },
      { pricing_mode: 'item', m2: '', thickness_mm: '', quantity: '5' } as never,
      { pricing_mode: 'm3', m2: '100', thickness_mm: '' }, // saknar tjocklek → hoppas över
    ]);
    expect(lines).toEqual([
      'Vägg – 100 m² × 200 mm',
      'Snedtak – 50 m² × 300 mm',
      'Vindsisolering – 80 m² × 400 mm',
    ]);
  });

  // Rader som lagts till DIREKT på arbetsordern har ingen konstruktion — där finns bara en
  // artikelsökning. Blocket skrev då ut hela artikelnamnet, och installatören läste
  // artikelregistret i stället för var isoleringen ska sitta.
  it('buildMeasurementLines: härleder placeringen ur artikelnamnet NÄR anroparen ber om det', () => {
    const items = [
      // Det verkliga fallet från order #56.
      { pricing_mode: 'm3', article_name: 'EKOVILLA cellulosa 0,038W/mK vägg', m2: '162', thickness_mm: '190' },
      { pricing_mode: 'm3', article_name: 'EKOVILLA cellulosa 0,038W/mK snedtak', m2: '90', thickness_mm: '500' },
    ];
    expect(buildMeasurementLines(items, { inferConstruction: true })).toEqual([
      'EKOVILLA',
      'Vägg – 162 m² × 190 mm',
      'Snedtak – 90 m² × 500 mm',
    ]);
  });

  // ⚠️ Utan flaggan måste utdatan vara BYTE FÖR BYTE som förut. Offertformulärets
  // `adoptExistingMeasurementBlock` gör `handoffNotes.startsWith(block)`; ändras en enda
  // etikett låser sig varje redan sparad offert på inaktuella mått.
  it('buildMeasurementLines: härleder INTE utan flaggan — offertens byte-exakta jämförelse', () => {
    const items = [
      { pricing_mode: 'm3', article_name: 'EKOVILLA cellulosa 0,038W/mK vägg', m2: '162', thickness_mm: '190' },
    ];
    expect(buildMeasurementLines(items)).toEqual([
      'EKOVILLA',
      'EKOVILLA cellulosa 0,038W/mK vägg – 162 m² × 190 mm',
    ]);
  });

  it('buildMeasurementLines: radens LAGRADE konstruktion vinner över härledningen', () => {
    // Namnet säger vägg, raden säger vind. Det lagrade värdet sattes när artikeln valdes;
    // artikelnamnet kan ha ändrats sedan dess, så gissningen får inte köra över det.
    const lines = buildMeasurementLines(
      [{ pricing_mode: 'm3', construction: 'vind', article_name: 'EKOVILLA vägg', m2: '10', thickness_mm: '100' }],
      { inferConstruction: true },
    );
    expect(lines).toEqual(['EKOVILLA', 'Vind – 10 m² × 100 mm']);
  });

  it('buildMeasurementLines: artikelnamnet står kvar när det inte avslöjar någon placering', () => {
    const lines = buildMeasurementLines(
      [{ pricing_mode: 'm3', article_name: 'Lösull special', m2: '10', thickness_mm: '100' }],
      { inferConstruction: true },
    );
    expect(lines).toEqual(['Lösull special – 10 m² × 100 mm']);
  });

  it('buildMeasurementLines: materialrubrik + säckantal + total', () => {
    // 100 m² × 200 mm = 20 m³ × 45 kg/m³ = 900 kg; Ekovilla 14 kg/säck → ceil(64.3)=65
    const lines = buildMeasurementLines([
      { pricing_mode: 'm3', construction: 'vagg', article_name: 'EKOVILLA cellulosa vägg', m2: '100', thickness_mm: '200', density: '45' },
    ]);
    expect(lines).toEqual([
      'EKOVILLA',
      'Vägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck',
      '',
      'Totalt: 65 säck',
    ]);
  });

  it('buildMeasurementLines: flera material → separata rubriker + summerad total', () => {
    const lines = buildMeasurementLines([
      { pricing_mode: 'm3', construction: 'vagg', article_name: 'EKOVILLA vägg', m2: '100', thickness_mm: '200', density: '45' },
      { pricing_mode: 'm3', construction: 'vind', article_name: 'PAROC vind', m2: '50', thickness_mm: '400', density: '30' },
    ]);
    expect(lines).toEqual([
      'EKOVILLA',
      'Vägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck',
      '',
      'PAROC',
      'Vind – 50 m² × 400 mm @ 30 kg/m³ – 40 säck',
      '',
      'Totalt: 105 säck',
    ]);
  });

  it('buildMeasurementLines: rubrik utan säck när densitet saknas; okänt material → ingen rubrik/säck', () => {
    expect(buildMeasurementLines([
      { pricing_mode: 'm3', construction: 'vagg', article_name: 'EKOVILLA cellulosa', m2: '100', thickness_mm: '200' },
    ])).toEqual(['EKOVILLA', 'Vägg – 100 m² × 200 mm']);
    expect(buildMeasurementLines([
      { pricing_mode: 'm3', construction: 'vagg', article_name: 'Glasull okänt', m2: '100', thickness_mm: '200', density: '45' },
    ])).toEqual(['Vägg – 100 m² × 200 mm']);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ÖVRIGT — antals- och meterrader som säljaren valt in i beskrivningen.
  //
  // Alla antalsrader hör inte hemma där: vindduk lämnas ofta till kunden i förväg och
  // installatören utför inget moment för den. Därför är det ett aktivt val per rad, och
  // avsaknad av valet betyder NEJ — annars ändras utdatan för varje redan sparad offert.
  // ─────────────────────────────────────────────────────────────────────────────

  describe('ÖVRIGT-gruppen', () => {
    it('tar med valda antalsrader sist, efter säcksumman', () => {
      expect(buildMeasurementLines([
        { pricing_mode: 'm3', construction: 'vagg', article_name: 'EKOVILLA cellulosa', m2: '100', thickness_mm: '200', density: '45' },
        { pricing_mode: 'item', article_name: 'Brandmatta', quantity: '4', article_unit_name: 'st', include_in_description: true },
        { pricing_mode: 'item', article_name: 'Sarg runt lucka', quantity: '6', article_unit_name: 'st', include_in_description: true },
        // Enheten är inte hårdkodad till "st" — den skrivs ut som artikelregistret har den.
        // Namnet är med flit en neutral fixtur: vilka artiklar som går i meter är en fråga om
        // data i Fortnox, inte om den här koden, och gissningar här läses som domänfakta.
        { pricing_mode: 'item', article_name: 'Artikel med meterenhet', quantity: '12', article_unit_name: 'm', include_in_description: true },
      ])).toEqual([
        'EKOVILLA',
        'Vägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck',
        '',
        'Totalt: 65 säck',
        '',
        'ÖVRIGT',
        'Brandmatta – 4 st',
        'Sarg runt lucka – 6 st',
        'Artikel med meterenhet – 12 m',
      ]);
    });

    // ⚠️ HELA SÄKERHETEN i utrullningen. Rader sparade före flaggan fanns saknar den, och plockas
    // de in ändras blocket för varje befintlig offert → adoptExistingMeasurementBlock matchar
    // inte längre → offerten öppnas LÅST på inaktuella mått. Saknat värde måste betyda NEJ.
    it('utelämnar antalsrader utan flaggan — byte-identisk utdata för redan sparade offerter', () => {
      expect(buildMeasurementLines([
        { pricing_mode: 'm3', construction: 'vagg', m2: '100', thickness_mm: '200' },
        { pricing_mode: 'item', article_name: 'Vindduk', quantity: '2', article_unit_name: 'st' },
        { pricing_mode: 'item', article_name: 'Brandmatta', quantity: '4', article_unit_name: 'st', include_in_description: false },
      ])).toEqual(['Vägg – 100 m² × 200 mm']);
    });

    // Tom rubrik utan rader är värre än ingen rubrik alls — den läses som att något fattas.
    it('hoppar över rader utan namn eller utan positiv mängd, och skriver då ingen rubrik', () => {
      expect(buildMeasurementLines([
        { pricing_mode: 'item', article_name: 'Brandmatta', quantity: '', include_in_description: true },
        { pricing_mode: 'item', article_name: 'Sarg', quantity: '0', include_in_description: true },
        { pricing_mode: 'item', article_name: '', quantity: '4', include_in_description: true },
      ])).toEqual([]);
    });

    it('utelämnar enheten när artikeln saknar den, och faller tillbaka på radtexten', () => {
      expect(buildMeasurementLines([
        { pricing_mode: 'item', article_name: 'Brandmatta', quantity: '4', include_in_description: true },
        { pricing_mode: 'item', line_note: 'Extra plastning', quantity: '2', article_unit_name: 'st', include_in_description: true },
      ])).toEqual(['ÖVRIGT', 'Brandmatta – 4', 'Extra plastning – 2 st']);
    });

    // 🧨 Fortnox enhetsregister är fritext. Skrev byggaren ut "löpande meter" men igenkännaren
    // krävde ett ensamt token blev raden en föräldralös rest som städningen inte ser — och nästa
    // omgenerering la ett block ovanpå den. Enheten utelämnas hellre än att glida isär.
    it('utelämnar en flerordsenhet i stället för att skriva en rad städningen inte känner igen', () => {
      const lines = buildMeasurementLines([
        { pricing_mode: 'item', article_name: 'Artikel med flerordsenhet', quantity: '12', article_unit_name: 'löpande meter', include_in_description: true },
      ]);
      expect(lines).toEqual(['ÖVRIGT', 'Artikel med flerordsenhet – 12']);
      expect(stripMeasurementBlock(`${lines.join('\n')}\n\nEgen text`)).toBe('Egen text');
    });

    // Flaggan gäller bara antals-/meterrader. En m³-rad är själva jobbet och står redan bland
    // måttraderna — den får inte dyka upp en andra gång under ÖVRIGT.
    it('lyfter INTE en m³-rad till ÖVRIGT även om flaggan är satt', () => {
      expect(buildMeasurementLines([
        { pricing_mode: 'm3', construction: 'vagg', m2: '100', thickness_mm: '200', quantity: '5', include_in_description: true },
      ])).toEqual(['Vägg – 100 m² × 200 mm']);
    });

    // En offert som bara säljer moment per styck har ingen måttrad alls. Blocket måste ändå
    // byggas, kännas igen och städas — annars staplade omgenereringen dubbletter.
    describe('block med enbart ÖVRIGT-rader', () => {
      const EXTRAS_ONLY = ['ÖVRIGT', 'Brandmatta – 4 st'];
      const items = [{ pricing_mode: 'item', article_name: 'Brandmatta', quantity: '4', article_unit_name: 'st', include_in_description: true }];

      it('byggs utan måttrader', () => {
        expect(buildMeasurementLines(items)).toEqual(EXTRAS_ONLY);
      });

      // ⚠️ hasMeasurementBlock styr LÅSET. Missar den ett extras-only-block låser sig aldrig
      // automatiken, och säljarens egen redigering skrivs över vid varje radändring.
      it('räknas som ett block, så automatiken kan lämna över ägarskapet', () => {
        expect(hasMeasurementBlock(EXTRAS_ONLY.join('\n'))).toBe(true);
      });

      it('städas bort, och omgenerering staplar inte', () => {
        const notes = `${EXTRAS_ONLY.join('\n')}\n\nRing Kalle innan`;
        expect(stripMeasurementBlock(notes)).toBe('Ring Kalle innan');
        expect(regenerateMeasurementBlock(notes, EXTRAS_ONLY.join('\n'))).toBe(notes);
      });
    });

    it('städar bort hela blocket inklusive ÖVRIGT och behåller egen text', () => {
      const block = 'EKOVILLA\nVägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck\n\nTotalt: 65 säck\n\nÖVRIGT\nBrandmatta – 4 st';
      const notes = `${block}\n\nPorten är låst, ring Kalle`;
      expect(stripMeasurementBlock(notes)).toBe('Porten är låst, ring Kalle');
      expect(regenerateMeasurementBlock(notes, block)).toBe(notes);
    });

    // ⚠️ "Portkod – 1234" har exakt samma form som en ÖVRIGT-rad. Den skyddas av ankringen:
    // en rad räknas som ÖVRIGT-rad bara inuti sin egen körning, och blocket skiljs alltid från
    // säljarens text av en tomrad.
    it('äter inte egen text som råkar ha samma form som en ÖVRIGT-rad', () => {
      const own = [
        'Portkod – 1234',
        'Etapp 2 – 3 veckor',
        'Kontakta platschef – 070 123 45 67',
        'Faktureras enligt avtal – se bilaga 3',
        'OBS: garaget mättes till 30 m² × 100 mm',
      ].join('\n');
      const notes = `ÖVRIGT\nBrandmatta – 4 st\n\n${own}`;
      expect(stripMeasurementBlock(notes)).toBe(own);
    });

    // ⚠️ Säckraden matchar ÖVRIGT-mönstret via sitt ANDRA tankstreck ("… – 65 säck"). Utan
    // företrädesregeln (måttrad vinner) blev den tvetydigt klassad.
    it('klassar en säckrad som måttrad, inte som ÖVRIGT-rad', () => {
      const sackLine = 'Vägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck';
      expect(hasMeasurementBlock(`ÖVRIGT\n${sackLine}`)).toBe(true);
      // Rubriken får inte adoptera måttraden som sin egen — den städas som det block den är.
      expect(stripMeasurementBlock(`ÖVRIGT\n${sackLine}\n\nEgen text`)).toBe('ÖVRIGT\n\nEgen text');
    });

    // Rubriken ensam, utan en rad under, är säljarens egen text.
    it('räknar inte en ensam ÖVRIGT-rubrik som block', () => {
      expect(hasMeasurementBlock('ÖVRIGT\nKom ihåg att ta med stege')).toBe(false);
      expect(stripMeasurementBlock('ÖVRIGT\nKom ihåg att ta med stege')).toBe('ÖVRIGT\nKom ihåg att ta med stege');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Måttblocket fylls i AUTOMATISKT när en artikelrad får mått. Det gör de här
  // reglerna skarpa: automatiken kör på varje tangenttryckning i måttfälten, så en
  // trasig ersättning staplar dubbletter i stället för att synas en gång.
  // ─────────────────────────────────────────────────────────────────────────────

  describe('replaceMeasurementBlock', () => {
    const BLOCK = 'Vägg – 100 m² × 200 mm';
    const NEXT = 'Vägg – 120 m² × 200 mm';

    it('lägger blocket överst i en tom arbetsbeskrivning', () => {
      expect(replaceMeasurementBlock('', '', BLOCK)).toBe(BLOCK);
    });

    it('behåller säljarens egen text under blocket', () => {
      expect(replaceMeasurementBlock('Ring innan ankomst', '', BLOCK)).toBe(`${BLOCK}\n\nRing innan ankomst`);
    });

    it('BYTER UT föregående block i stället för att stapla dubbletter', () => {
      const first = replaceMeasurementBlock('Ring innan ankomst', '', BLOCK)!;
      const second = replaceMeasurementBlock(first, BLOCK, NEXT);
      expect(second).toBe(`${NEXT}\n\nRing innan ankomst`);
      // Det gamla måttet får inte ligga kvar någonstans i texten.
      expect(second).not.toContain('100 m²');
    });

    it('returnerar null när säljaren har redigerat blocket — texten är deras nu', () => {
      expect(replaceMeasurementBlock('Vägg – 90 m² × 200 mm', BLOCK, NEXT)).toBeNull();
    });

    // Regression: enbart `startsWith` matchade även här, och tillägget blev hängande kvar
    // som lös text när blocket byttes ut.
    it('returnerar null när säljaren skrivit till på blockets sista rad', () => {
      expect(replaceMeasurementBlock(`${BLOCK} (mätt på plats)`, BLOCK, NEXT)).toBeNull();
    });

    it('force skriver ändå — knappen är ett uttryckligt klick', () => {
      expect(replaceMeasurementBlock('Egen text', BLOCK, NEXT, { force: true })).toBe(`${NEXT}\n\nEgen text`);
    });

    // Knappen är ENDA vägen tillbaka när automatiken lämnat över ägarskapet, så den vägen
    // måste vara ren: staplas blocken bär arbetsbeskrivningen två uppsättningar mått, och
    // den inaktuella ligger kvar underst hela vägen ut till installatören.
    it('force staplar INTE ett nytt block ovanpå ett redigerat', () => {
      const edited = `Vägg – 90 m² × 200 mm (mätt på plats)\n\nRing innan ankomst`;
      const result = replaceMeasurementBlock(edited, BLOCK, NEXT, { force: true });
      expect(result).toBe(`${NEXT}\n\nRing innan ankomst`);
      expect(result).not.toContain('90 m²');
    });

    // ⚠️ Läget efter att automatiken lämnat över: ingen referens sparad OCH låset satt. Det är
    // exakt då knappen är enda vägen tillbaka. Städade force inte här la klicket ett nytt block
    // ovanpå det gamla — och eftersom klicket sedan tar tillbaka ägarskapet blev de inaktuella
    // måtten permanenta, hela vägen ut till arbetsordern.
    it('force städar ÄVEN när ingen referens finns sparad', () => {
      const edited = 'Vägg – 90 m² × 200 mm\n\nRing innan ankomst';
      const result = replaceMeasurementBlock(edited, '', NEXT, { force: true });
      expect(result).toBe(`${NEXT}\n\nRing innan ankomst`);
      expect(result).not.toContain('90 m²');
    });

    it('utan force och utan referens läggs blocket bara överst (första insättningen)', () => {
      expect(replaceMeasurementBlock('Ring innan ankomst', '', BLOCK)).toBe(`${BLOCK}\n\nRing innan ankomst`);
    });

    it('tomt nextBlock tar bort blocket men behåller säljarens text', () => {
      const withBlock = `${BLOCK}\n\nRing innan ankomst`;
      expect(replaceMeasurementBlock(withBlock, BLOCK, '')).toBe('Ring innan ankomst');
    });

    it('tomt nextBlock på en text som BARA var block ger tom sträng', () => {
      expect(replaceMeasurementBlock(BLOCK, BLOCK, '')).toBe('');
    });
  });

  describe('stripMeasurementBlock', () => {
    it('tar bort ett helt block med rubrik, mått och total', () => {
      const notes = 'EKOVILLA\nVägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck\n\nTotalt: 65 säck\n\nRing innan ankomst';
      expect(stripMeasurementBlock(notes)).toBe('Ring innan ankomst');
    });

    it('tar bort ett REDIGERAT block — det är hela poängen', () => {
      expect(stripMeasurementBlock('Vägg – 90 m² × 200 mm (mätt på plats)\n\nEgen text')).toBe('Egen text');
    });

    it('lämnar text utan block orörd', () => {
      expect(stripMeasurementBlock('Ring innan ankomst\nPorten är låst')).toBe('Ring innan ankomst\nPorten är låst');
    });

    // Blocket söks var som helst, inte bara först: på arbetsordern skriver kontoret ofta en
    // rad överst, och letade vi bara i position 0 blev det gamla blocket kvar under det nya.
    it('hittar blocket även när text står ovanför det', () => {
      expect(stripMeasurementBlock('Ring innan ankomst\n\nVägg – 100 m² × 200 mm')).toBe('Ring innan ankomst');
      expect(stripMeasurementBlock('OBS! Ring Kalle\n\nEKOVILLA\nVägg – 80 m² × 200 mm @ 45 kg/m³ – 52 säck\n\nTotalt: 52 säck'))
        .toBe('OBS! Ring Kalle');
    });

    // En rubrik måste vara ett KÄNT materialnamn. Regeln "vilken rad som helst som följs av
    // en måttrad" raderade säljarens egen text när den stod direkt ovanför blocket.
    it('raderar inte en egen rad som råkar stå direkt ovanför måttraden', () => {
      expect(stripMeasurementBlock('Porten är låst\nVägg – 100 m² × 200 mm\n\nEgen text'))
        .toBe('Porten är låst\n\nEgen text');
    });

    it('lämnar text utan måttrader helt orörd', () => {
      expect(stripMeasurementBlock('Anteckning\nRing innan')).toBe('Anteckning\nRing innan');
    });

    // ⚠️ Verkligt fall: arbetsorder #56, vars beskrivning grupperats för hand i "Huset:" och
    // "Garage:". En enda städningskörning stannade vid "Garage:" och lämnade måtten under kvar —
    // det nya blocket lades ovanpå och installatören fick TVÅ uppsättningar mått, med den
    // inaktuella sist. Ingen måttrad får överleva; prosan ska däremot stå kvar.
    it('tar bort ALLA måttkörningar när egen text delar upp blocket', () => {
      const notes = [
        'Huset:',
        'Vägg – 162 m² × 190 mm @ 52 kg/m³ – 115 säck',
        'Vind – 100 m² × 500 mm @ 32 kg/m³ – 115 säck',
        'Garage:',
        'Vägg – 67,5 m² × 145 mm @ 52 kg/m³ – 37 säck',
        '',
        'Totalt: 451 säck',
      ].join('\n');
      const stripped = stripMeasurementBlock(notes);
      expect(stripped).not.toMatch(/m²/);
      expect(stripped).not.toMatch(/Totalt:/);
      expect(stripped).toContain('Huset:');
      expect(stripped).toContain('Garage:');
    });

    // ⚠️ Skräpet i datan gjorde städaren BLIND. Ett m²-fält med "162m" gav raden "… – 162m m² ×
    // 190 mm …", som inte matchade måttmönstret — så just den raden överlevde och stod kvar som
    // ett inaktuellt mått under det nya blocket. Nya rader kan inte få formen längre, men texten
    // som redan skrivits gör det.
    it('känner igen en måttrad även med en vilsen enhet i arean', () => {
      expect(stripMeasurementBlock('Vägg – 162m m² × 190 mm @ 52 kg/m³ – 115 säck\n\nEgen text'))
        .toBe('Egen text');
    });

    // ⚠️ mm² är kabelarea och förekommer på riktigt i en byggtext. Utan blankstegskravet i
    // mönstret räknades raden som en måttrad — den hade låst offertens automatik och blivit
    // uppäten av städningen.
    it('tar INTE en mm²-rad för en måttrad', () => {
      const notes = 'Dra kabel 2,5 mm² × 3 till fläkten';
      expect(stripMeasurementBlock(notes)).toBe(notes);
    });

    // ⚠️ Omkörningen får bara ta text som bevisligen är genererad. Säljare skriver mått i
    // löptext, och en glupsk omkörning åt upp meningen.
    it('äter inte upp en egen mening som råkar innehålla ett mått', () => {
      const notes = [
        'Vägg – 100 m² × 200 mm @ 45 kg/m³ – 65 säck',
        '',
        'Totalt: 65 säck',
        'Porten är låst.',
        'OBS: garaget mättes till 30 m² × 100 mm på plats, ring Kalle innan.',
      ].join('\n');
      expect(stripMeasurementBlock(notes))
        .toBe('Porten är låst.\nOBS: garaget mättes till 30 m² × 100 mm på plats, ring Kalle innan.');
    });
  });

  // Arbetsorderns väg: ingen automatik äger texten där, så knappen bygger alltid om blocket.
  // Den vägen finns för att artiklar rättas EFTER att ordern skapats — då står beskrivningen
  // kvar på offertens mått, och offerten är låst vid det laget.
  describe('regenerateMeasurementBlock', () => {
    const BLOCK = 'Vägg – 100 m² × 200 mm';

    it('lägger blocket överst i en tom notering', () => {
      expect(regenerateMeasurementBlock('', BLOCK)).toBe(BLOCK);
    });

    it('behåller text som skrivits under blocket', () => {
      expect(regenerateMeasurementBlock('Ring innan ankomst', BLOCK)).toBe(`${BLOCK}\n\nRing innan ankomst`);
    });

    it('BYTER UT offertens gamla block i stället för att stapla', () => {
      const fromQuote = 'EKOVILLA\nVägg – 80 m² × 200 mm @ 45 kg/m³ – 52 säck\n\nTotalt: 52 säck\n\nRing innan ankomst';
      const result = regenerateMeasurementBlock(fromQuote, BLOCK);
      expect(result).toBe(`${BLOCK}\n\nRing innan ankomst`);
      expect(result).not.toContain('80 m²');
    });

    it('är idempotent — två klick ger samma text', () => {
      const once = regenerateMeasurementBlock('Ring innan ankomst', BLOCK);
      expect(regenerateMeasurementBlock(once, BLOCK)).toBe(once);
    });
  });

  describe('hasMeasurementBlock', () => {
    it('känner igen en måttrad', () => {
      expect(hasMeasurementBlock('Vägg – 100 m² × 200 mm')).toBe(true);
      expect(hasMeasurementBlock('EKOVILLA\nVind – 50 m² × 400 mm @ 30 kg/m³ – 40 säck')).toBe(true);
    });

    it('slår inte till på vanlig löptext', () => {
      expect(hasMeasurementBlock('Ring innan ankomst, 200 kvm vind')).toBe(false);
      expect(hasMeasurementBlock('')).toBe(false);
    });
  });
});
