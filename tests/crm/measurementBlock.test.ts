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
