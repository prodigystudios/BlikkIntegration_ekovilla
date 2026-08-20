import { describe, it, expect } from 'vitest';
import {
  constructionFromEtappRow,
  finalSackEntriesFromEtappRows,
  materialShortFromEgenkontroll,
} from '@/lib/domains/egenkontroll/sackReport';
import { etappRowsFromLineItems } from '@/lib/domains/egenkontroll/projectSource';
import { sumOpenBags, sumClosedBags } from '@/lib/domains/egenkontroll/calculations';

// Dörr 1: egenkontrollens rader → final-rader i huvudboken. Två fällor bor här och båda är tysta:
// materialet är en NYCKEL och inte en short (fel värde möter aldrig depåns leveranser), och
// etappradens `etapp` är en fri etikett som INTE bär placeringen.

describe('materialShortFromEgenkontroll', () => {
  // 🧨 materialUsed är en nyckel i MATERIALS. Skrivs nyckeln rakt in i boken hamnar den där som ett
  // material depån aldrig sett en leverans av — computeDepotBalances matchar på exakt sträng.
  it('nyckeln i MATERIALS blir depåns short', () => {
    expect(materialShortFromEgenkontroll('Ekovilla Cellulosa Lösull CE ETA-09/0081')).toBe('EKOVILLA');
    expect(materialShortFromEgenkontroll('PAROC SHT 1, Lösull vind 0809-CPR-1014')).toBe('PAROC');
  });

  it('okänt eller tomt material ger null — då faller depåavdraget tillbaka på artikelraderna', () => {
    expect(materialShortFromEgenkontroll('Glasull')).toBeNull();
    expect(materialShortFromEgenkontroll('')).toBeNull();
    expect(materialShortFromEgenkontroll(null)).toBeNull();
    expect(materialShortFromEgenkontroll(undefined)).toBeNull();
  });

  // Att skicka in en short i stället för en nyckel är precis det förväxlingsfel funktionen finns
  // för att fånga — den ska INTE tas emot bara för att den råkar se rätt ut.
  it('en short är inte en nyckel och släpps inte igenom', () => {
    expect(materialShortFromEgenkontroll('EKOVILLA')).toBeNull();
  });
});

describe('constructionFromEtappRow', () => {
  it('slug:en som burits med från offertraden vinner', () => {
    expect(constructionFromEtappRow({ construction: 'vind', etapp: 'Yttervägg' })).toBe('vind');
  });

  // Etiketten föredrar radens line_note ("Yttervägg"), så den duger inte som placering — men skrev
  // installatören själv det kanoniska ordet är det ett svar värt att ta emot.
  it('utan slug godtas en EXAKT etikett, oavsett skiftläge', () => {
    expect(constructionFromEtappRow({ etapp: 'Golv' })).toBe('golv');
    expect(constructionFromEtappRow({ etapp: 'mellanbjälklag' })).toBe('mellanbjalklag');
    expect(constructionFromEtappRow({ etapp: '  Vind  ' })).toBe('vind');
  });

  // ⚠️ Aldrig fuzzy. "Vindsfarstun" är inte vinden, och en felplacerad säck syns aldrig hos oss.
  it('en etikett som bara INNEHÅLLER ordet gissas inte', () => {
    expect(constructionFromEtappRow({ etapp: 'Vindsfarstun' })).toBeNull();
    expect(constructionFromEtappRow({ etapp: 'Golv i garaget' })).toBeNull();
    expect(constructionFromEtappRow({ etapp: 'Yttervägg' })).toBeNull();
  });

  it('en slug som inte finns i vokabulären blir null, inte ett värde databasens CHECK avvisar', () => {
    expect(constructionFromEtappRow({ construction: 'takstol', etapp: 'Takstol' })).toBeNull();
    expect(constructionFromEtappRow({ construction: '' })).toBeNull();
    expect(constructionFromEtappRow({})).toBeNull();
  });
});

describe('finalSackEntriesFromEtappRows', () => {
  const MATERIAL = 'Ekovilla Cellulosa Lösull CE ETA-09/0081';

  it('en rad per etapp med ifyllt säckantal, ur båda tabellerna', () => {
    const entries = finalSackEntriesFromEtappRows(
      [{ etapp: 'Vind', construction: 'vind', antalSack: '60' }],
      [{ etapp: 'Yttervägg', construction: 'vagg', antalSackKgPerSack: '31' }],
      MATERIAL,
    );
    expect(entries).toEqual([
      { construction: 'vind', sacks_blown: 60, material: 'EKOVILLA' },
      { construction: 'vagg', sacks_blown: 31, material: 'EKOVILLA' },
    ]);
  });

  it('en tom säckruta hoppas över, men en ifylld NOLLA behålls', () => {
    const entries = finalSackEntriesFromEtappRows(
      [
        { etapp: 'Vind', construction: 'vind', antalSack: '' },
        { etapp: 'Vind 2', construction: 'vind', antalSack: '0' },
        { etapp: 'Vind 3', construction: 'vind' },
      ],
      [],
      MATERIAL,
    );
    expect(entries).toEqual([{ construction: 'vind', sacks_blown: 0, material: 'EKOVILLA' }]);
  });

  it('en rad installatören lagt till själv blir Ospecificerad, inte avvisad', () => {
    const entries = finalSackEntriesFromEtappRows([{ etapp: 'Krypgrund', antalSack: '12' }], [], MATERIAL);
    expect(entries).toEqual([{ construction: null, sacks_blown: 12, material: 'EKOVILLA' }]);
  });

  it('två etapprader med samma placering är tillåtet — finalerna summeras ändå', () => {
    const entries = finalSackEntriesFromEtappRows(
      [{ construction: 'vind', antalSack: '30' }, { construction: 'vind', antalSack: '25' }],
      [],
      MATERIAL,
    );
    expect(entries.map((e) => e.sacks_blown)).toEqual([30, 25]);
  });

  it('inga rader ger inga poster — då skickar klienten ingenting alls', () => {
    expect(finalSackEntriesFromEtappRows([], [], MATERIAL)).toEqual([]);
    expect(finalSackEntriesFromEtappRows([{ etapp: 'Vind' }], [], MATERIAL)).toEqual([]);
  });

  // ⚠️ Kommentaren "Antal säckar: N" och huvudbokens rader hamnar på SAMMA dokument. Tolkar de två
  // ett värde olika säger dokumentet och boken olika saker om samma egenkontroll.
  it('summan matchar sumOpenBags + sumClosedBags exakt, inklusive deras egen brist på komma-tal', () => {
    const open = [{ antalSack: '60' }, { antalSack: '12,5' }, { antalSack: '' }];
    const closed = [{ antalSackKgPerSack: '31' }];
    const fromLedger = finalSackEntriesFromEtappRows(open, closed, MATERIAL).reduce((s, e) => s + e.sacks_blown, 0);
    expect(fromLedger).toBe(sumOpenBags(open) + sumClosedBags(closed));
    expect(fromLedger).toBe(91);
  });
});

// Slug:en måste faktiskt komma HELA vägen från offertraden, annars är etikettreserven ovan det enda
// som återstår och nästan varje rad blir Ospecificerad.
describe('etappRowsFromLineItems bär slug:en vidare', () => {
  it('placeringen följer med både öppna och slutna etapprader', () => {
    const { open, closed } = etappRowsFromLineItems([
      { construction: 'vind', m2: '120', thickness_mm: '500', density: '30', article_name: 'Ekovilla', line_note: 'Vinden ovan garaget' },
      { construction: 'golv', m2: '40', thickness_mm: '200', density: '45', article_name: 'Ekovilla', line_note: '' },
    ] as never);

    expect(open[0].construction).toBe('vind');
    expect(closed[0].construction).toBe('golv');
    // Etiketten är fortfarande line_note när den finns — den är för människan, slug:en för boken.
    expect(open[0].etapp).toBe('Vinden ovan garaget');
    expect(closed[0].etapp).toBe('Golv');
  });

  it('en offertrad utan placering ger ingen slug i stället för en tom sträng', () => {
    const { closed } = etappRowsFromLineItems([
      { construction: '', m2: '40', thickness_mm: '200', density: '45', article_name: 'Ekovilla' },
    ] as never);
    expect(closed[0].construction).toBeUndefined();
    expect(constructionFromEtappRow(closed[0])).toBeNull();
  });

  it('slug:en överlever hela vägen till en huvudboksrad', () => {
    const { open, closed } = etappRowsFromLineItems([
      { construction: 'mellanbjalklag', m2: '40', thickness_mm: '200', density: '45', article_name: 'Ekovilla' },
    ] as never);
    const withSacks = closed.map((r) => ({ ...r, antalSackKgPerSack: '10' }));
    expect(finalSackEntriesFromEtappRows(open, withSacks, 'Ekovilla Cellulosa Lösull CE ETA-09/0081')).toEqual([
      { construction: 'mellanbjalklag', sacks_blown: 10, material: 'EKOVILLA' },
    ]);
  });
});
