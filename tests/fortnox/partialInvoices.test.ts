import { describe, it, expect } from 'vitest';
import {
  computeInvoiceState,
  activeLineItems,
  validateLineItemEdit,
  validatePartialRequest,
  buildInvoiceRows,
  roundSubtotal,
  hasCarvedRotLabor,
  partialInvoiceReferenceField,
  partialInvoiceRotPropertyNote,
  PartialInvoiceError,
  type PartialInvoiceLineItem,
} from '@/lib/domains/fortnox/partialInvoices';

const itemLine = (overrides: Partial<PartialInvoiceLineItem> = {}): PartialInvoiceLineItem => ({
  pricing_mode: 'item',
  unit_price: '100',
  quantity: '50',
  ...overrides,
});

describe('computeInvoiceState', () => {
  it('reports the full quantity as remaining when there are no prior rounds', () => {
    const [state] = computeInvoiceState([itemLine()], []);
    // lineId är null här eftersom testraden saknar id — då nycklas den fortfarande på position.
    expect(state).toEqual({ lineId: null, index: 0, total: 50, invoiced: 0, remaining: 50 });
  });

  it('subtracts a single prior round from the remaining', () => {
    const [state] = computeInvoiceState([itemLine()], [{ line_quantities: [{ index: 0, quantity: 30 }] }]);
    expect(state).toMatchObject({ invoiced: 30, remaining: 20 });
  });

  it('sums multiple prior rounds per line', () => {
    const [state] = computeInvoiceState([itemLine()], [
      { line_quantities: [{ index: 0, quantity: 30 }] },
      { line_quantities: [{ index: 0, quantity: 10 }] },
    ]);
    expect(state).toMatchObject({ invoiced: 40, remaining: 10 });
  });

  it('uses the computed m³ volume (m² × thickness / 1000) as the line total', () => {
    const [state] = computeInvoiceState([{ pricing_mode: 'm3', m2: '100', thickness_mm: '200', unit_price: '700' }], []);
    expect(state.total).toBe(20);
    expect(state.remaining).toBe(20);
  });

  it('never returns a negative remaining', () => {
    const [state] = computeInvoiceState([itemLine({ quantity: '10' })], [{ line_quantities: [{ index: 0, quantity: 15 }] }]);
    expect(state.remaining).toBe(0);
  });
});

describe('validatePartialRequest', () => {
  const state = () => computeInvoiceState([itemLine(), itemLine({ quantity: '10' })], []);

  it('accepts a request within remaining and dedupes quantities by index', () => {
    const { requestByKey, isFinalRound } = validatePartialRequest(state(), [
      { index: 0, quantity: 20 },
      { index: 0, quantity: 5 },
    ]);
    expect(requestByKey.get('#0')).toBe(25);
    expect(isFinalRound).toBe(false);
  });

  it('rejects invoicing more than a line has remaining', () => {
    expect(() => validatePartialRequest(state(), [{ index: 0, quantity: 60 }])).toThrow(PartialInvoiceError);
  });

  it('rejects an all-zero request', () => {
    expect(() => validatePartialRequest(state(), [{ index: 0, quantity: 0 }])).toThrow(PartialInvoiceError);
  });

  it('rejects an unknown line index', () => {
    expect(() => validatePartialRequest(state(), [{ index: 9, quantity: 1 }])).toThrow(PartialInvoiceError);
  });

  it('flags the final round only when every line reaches zero remaining', () => {
    const partial = validatePartialRequest(state(), [{ index: 0, quantity: 50 }]);
    expect(partial.isFinalRound).toBe(false); // line 1 still has 10 left

    const final = validatePartialRequest(state(), [{ index: 0, quantity: 50 }, { index: 1, quantity: 10 }]);
    expect(final.isFinalRound).toBe(true);
  });

  it('flags the final round across rounds (remaining measured from prior rounds)', () => {
    const afterFirst = computeInvoiceState([itemLine()], [{ line_quantities: [{ index: 0, quantity: 30 }] }]);
    const { isFinalRound } = validatePartialRequest(afterFirst, [{ index: 0, quantity: 20 }]);
    expect(isFinalRound).toBe(true);
  });
});

describe('buildInvoiceRows', () => {
  it('emits a row only for lines with a positive quantity, using DeliveredQuantity', () => {
    const rows = buildInvoiceRows([itemLine(), itemLine()], new Map([['#1', 5]]), 25, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ DeliveredQuantity: 5, Price: 100, VAT: 25 });
    // Invoice rows use DeliveredQuantity, not OrderedQuantity/Quantity.
    expect((rows[0] as any).OrderedQuantity).toBeUndefined();
    expect((rows[0] as any).Quantity).toBeUndefined();
  });

  it('sends a percentage discount with DiscountType PERCENT', () => {
    const [row] = buildInvoiceRows([itemLine({ discount_percent: '25' })], new Map([['#0', 10]]), 25, false);
    expect(row).toMatchObject({ Discount: 25, DiscountType: 'PERCENT' });
  });

  it('marks HouseWork only when ROT is enabled and the row is rot work', () => {
    const on = buildInvoiceRows([itemLine({ is_rot_work: true })], new Map([['#0', 1]]), 25, true);
    expect(on[0]).toMatchObject({ HouseWork: true, HouseWorkType: 'CONSTRUCTION' });
    // Non-ROT → HouseWork omitted (never false — that stamps EMPTYHOUSEWORK and 2004021).
    const off = buildInvoiceRows([itemLine({ is_rot_work: true })], new Map([['#0', 1]]), 25, false);
    expect((off[0] as any).HouseWork).toBeUndefined();
  });

  it('forces 0 % VAT on rows for reverse charge (byggmoms), else the passed vatPercent', () => {
    const [reverse] = buildInvoiceRows([itemLine()], new Map([['#0', 10]]), 25, false, true);
    expect((reverse as any).VAT).toBe(0);
    const [normal] = buildInvoiceRows([itemLine()], new Map([['#0', 10]]), 25, false, false);
    expect((normal as any).VAT).toBe(25);
  });

  it('appends the ROT property note as a trailing text row on the partial invoice', () => {
    const rows = buildInvoiceRows([itemLine()], new Map([['#0', 10]]), 25, true, false, 'Fastighetsbeteckning: Haggården 6:3');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ Description: 'Fastighetsbeteckning: Haggården 6:3' });
    expect((rows[1] as any).DeliveredQuantity).toBeUndefined();
  });
});

describe('roundSubtotal', () => {
  it('sums quantity × unit price for the billed lines', () => {
    expect(roundSubtotal([itemLine({ unit_price: '100' })], new Map([['#0', 30]]))).toBe(3000);
  });

  it('applies the line discount', () => {
    expect(roundSubtotal([itemLine({ unit_price: '100', discount_percent: '25' })], new Map([['#0', 10]]))).toBe(750);
  });
});

describe('hasCarvedRotLabor (partial-invoice Phase-2 guard)', () => {
  it('detects a material row with carved-out labour', () => {
    // 40 kr/enhet av à-priset 100 → 2 000 kr bryts ut över 50 enheter.
    expect(hasCarvedRotLabor([itemLine({ labor_cost: '40' })])).toBe(true);
  });

  it('säger nej när beloppet äter hela à-priset — då bryts ingenting ut', () => {
    // Guarden frågar om något FAKTISKT bryts ut, inte om fältet är ifyllt. Ett belopp som lämnar
    // noll material bryter ut noll (se splitRowLabor), och en sådan order har ingenting att
    // proportionera — att ändå spärra delfaktureringen hade låst den på ett värde som inte längre
    // betyder något. Gäller varje rad sparad under den gamla klumpbeloppstolkningen.
    expect(hasCarvedRotLabor([itemLine({ labor_cost: '500' })])).toBe(false);
    expect(hasCarvedRotLabor([itemLine({ labor_cost: '100' })])).toBe(false);
  });

  it('ignores labour on a row flagged fully as ROT work (whole row is the labour, invoiced per row)', () => {
    expect(hasCarvedRotLabor([itemLine({ is_rot_work: true, labor_cost: '500' })])).toBe(false);
  });

  it('returns false when nothing is carved (empty / zero / missing / null)', () => {
    expect(hasCarvedRotLabor([itemLine({ labor_cost: '' }), itemLine({ labor_cost: '0' }), itemLine()])).toBe(false);
    expect(hasCarvedRotLabor(null)).toBe(false);
  });
});

// En artikel som såldes men aldrig utfördes skrivs AV, den raderas inte. Radering hade förskjutit
// arrayindexen som varje fakturarunda lagrar sina antal mot — en redan utställd fakturas antal
// hade tyst pekat om till fel artikel. Flaggan gör återstående 0 så ordern kan stängas.
describe('computeInvoiceState — avskriven rad', () => {
  const three = [
    { pricing_mode: 'item', unit_price: '100', quantity: '10' },
    { pricing_mode: 'item', unit_price: '200', quantity: '5' },
    { pricing_mode: 'item', unit_price: '300', quantity: '2' },
  ];

  it('nollar återstående på en avskriven rad utan att röra dess antal', () => {
    const items = three.map((it, i) => (i === 2 ? { ...it, written_off: true } : it));
    const state = computeInvoiceState(items, []);
    expect(state[2].total).toBe(2);      // antalet står kvar — raden fanns
    expect(state[2].remaining).toBe(0);  // …men det finns inget kvar att fakturera
    expect(state[0].remaining).toBe(10); // övriga rader orörda
  });

  // Kärnan i buggen: utan avskrivning når isFinalRound aldrig sant, så ordern fastnar som
  // delfakturerad i evighet med en summa som räknar arbete som aldrig utfördes.
  it('låter sista rundan bli slutrunda när resten är avskriven', () => {
    const items = three.map((it, i) => (i === 2 ? { ...it, written_off: true } : it));
    const rounds = [{ line_quantities: [{ index: 0, quantity: 10 }] }];
    const state = computeInvoiceState(items, rounds);
    const { isFinalRound } = validatePartialRequest(state, [{ index: 1, quantity: 5 }]);
    expect(isFinalRound).toBe(true);
  });

  it('utan avskrivning är samma runda INTE slutrunda', () => {
    const state = computeInvoiceState(three, [{ line_quantities: [{ index: 0, quantity: 10 }] }]);
    const { isFinalRound } = validatePartialRequest(state, [{ index: 1, quantity: 5 }]);
    expect(isFinalRound).toBe(false);
  });

  it('vägrar fakturera en avskriven rad', () => {
    const items = three.map((it, i) => (i === 2 ? { ...it, written_off: true } : it));
    const state = computeInvoiceState(items, []);
    expect(() => validatePartialRequest(state, [{ index: 2, quantity: 1 }])).toThrow(/överstiger återstående/);
  });

  // Indexen får ALDRIG förskjutas — det är hela skälet till att raden flaggas i stället för raderas.
  it('behåller radernas index när en rad skrivs av', () => {
    const items = three.map((it, i) => (i === 0 ? { ...it, written_off: true } : it));
    const state = computeInvoiceState(items, []);
    expect(state.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(state[1].total).toBe(5);
    expect(state[2].total).toBe(2);
  });
});

describe('activeLineItems', () => {
  it('filtrerar bort avskrivna rader men behåller ordningen på resten', () => {
    const items = [{ id: 'a' }, { id: 'b', written_off: true }, { id: 'c' }];
    expect(activeLineItems(items).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('tål null och tom lista', () => {
    expect(activeLineItems(null)).toEqual([]);
    expect(activeLineItems([])).toEqual([]);
  });
});

// ── Nyckelbytet: rundorna refererar radens id, inte dess position ──────────────
// Positionen var bärande förut, vilket tvingade fram artikellåset: en tillagd eller borttagen rad
// pekade om en redan utställd fakturas antal till fel artikel. Testerna nedan är beviset för att
// det inte längre kan hända.
describe('computeInvoiceState — nycklad på line_id', () => {
  const a = { id: 'line-a', pricing_mode: 'item', unit_price: '100', quantity: '10' };
  const b = { id: 'line-b', pricing_mode: 'item', unit_price: '200', quantity: '5' };
  const rounds = [{ line_quantities: [{ line_id: 'line-b', quantity: 2 }] }];

  it('följer raden när den flyttar sig i listan', () => {
    const before = computeInvoiceState([a, b], rounds);
    expect(before.find((s) => s.lineId === 'line-b')!.invoiced).toBe(2);
    // Samma rader, omvänd ordning — fakturerat ska fortfarande sitta på line-b.
    const after = computeInvoiceState([b, a], rounds);
    expect(after.find((s) => s.lineId === 'line-b')!.invoiced).toBe(2);
    expect(after.find((s) => s.lineId === 'line-a')!.invoiced).toBe(0);
  });

  it('påverkas inte av att en ny rad läggs till före den fakturerade', () => {
    const nyRad = { id: 'line-c', pricing_mode: 'item', unit_price: '50', quantity: '3' };
    const state = computeInvoiceState([nyRad, a, b], rounds);
    expect(state.find((s) => s.lineId === 'line-b')!.invoiced).toBe(2);
    expect(state.find((s) => s.lineId === 'line-c')!.invoiced).toBe(0);
    expect(state.find((s) => s.lineId === 'line-c')!.remaining).toBe(3);
  });

  it('påverkas inte av att en ofakturerad rad tas bort', () => {
    const state = computeInvoiceState([b], rounds);
    expect(state[0].invoiced).toBe(2);
    expect(state[0].remaining).toBe(3);
  });

  // Rundor skrivna före migreringen bär bara index. De måste fortfarande läsas rätt.
  it('faller tillbaka på position för en rad utan id', () => {
    const legacyRounds = [{ line_quantities: [{ index: 1, quantity: 2 }] }];
    const utanId = [{ pricing_mode: 'item', unit_price: '100', quantity: '10' }, { pricing_mode: 'item', unit_price: '200', quantity: '5' }];
    const state = computeInvoiceState(utanId, legacyRounds);
    expect(state[1].invoiced).toBe(2);
    expect(state[0].invoiced).toBe(0);
  });

  // Vakten mot att blanda ihop vägarna: en rad MED id får inte matcha en id-post för en annan rad
  // bara för att positionerna råkar sammanfalla.
  it('matchar aldrig en id-post mot fel rad', () => {
    const state = computeInvoiceState([a, b], [{ line_quantities: [{ line_id: 'line-okänd', quantity: 99 }] }]);
    expect(state.every((s) => s.invoiced === 0)).toBe(true);
  });
});

describe('validateLineItemEdit', () => {
  const a = { id: 'line-a', pricing_mode: 'item', unit_price: '100', quantity: '10' };
  const b = { id: 'line-b', pricing_mode: 'item', unit_price: '200', quantity: '5' };
  const rounds = [{ line_quantities: [{ line_id: 'line-b', quantity: 2 }] }];

  it('släpper igenom allt när inget är fakturerat', () => {
    expect(validateLineItemEdit([a, b], [], [])).toEqual({ ok: true });
  });

  it('tillåter att en ny artikel läggs till mitt i projektet', () => {
    const ny = { id: 'line-c', pricing_mode: 'item', unit_price: '50', quantity: '1' };
    expect(validateLineItemEdit([a, b], [a, b, ny], rounds).ok).toBe(true);
  });

  it('tillåter att en OFAKTURERAD rad tas bort', () => {
    expect(validateLineItemEdit([a, b], [b], rounds).ok).toBe(true);
  });

  it('nekar att en FAKTURERAD rad tas bort', () => {
    const res = validateLineItemEdit([a, b], [a], rounds);
    expect(res.ok).toBe(false);
    expect((res as any).message).toMatch(/fakturerad och kan inte tas bort/);
  });

  // Kärnan i den fastnade ordern: sänk till det som levererats så återstående blir noll.
  it('tillåter att antalet sänks NER TILL det fakturerade', () => {
    const sankt = { ...b, quantity: '2' };
    expect(validateLineItemEdit([a, b], [a, sankt], rounds).ok).toBe(true);
    expect(computeInvoiceState([a, sankt], rounds).find((s) => s.lineId === 'line-b')!.remaining).toBe(0);
  });

  it('nekar att antalet sänks UNDER det fakturerade', () => {
    const forLagt = { ...b, quantity: '1' };
    const res = validateLineItemEdit([a, b], [a, forLagt], rounds);
    expect(res.ok).toBe(false);
    expect((res as any).message).toMatch(/kan inte sänkas under/);
  });

  it('tillåter att antalet höjs på en fakturerad rad', () => {
    expect(validateLineItemEdit([a, b], [a, { ...b, quantity: '9' }], rounds).ok).toBe(true);
  });

  // 🧨 REGRESSION, reproducerad i granskningen: `is_rot_work` jämfördes som sträng. En rad sparad
  // innan flaggan fanns saknar den, schemat fyller i `false` vid nästa sparning, och '' ≠ 'false'
  // lästes som en ändring — alltså NEKADES en helt legitim antalssänkning på en gammal
  // delfakturerad order, med ett meddelande om att priset inte får ändras.
  it('äldre rad utan is_rot_work spärras inte av schemats default', () => {
    const legacy = { id: 'line-b', pricing_mode: 'item', unit_price: '200', quantity: '5' };
    const saved = { ...legacy, is_rot_work: false, quantity: '2' };
    expect(validateLineItemEdit([a, legacy], [a, saved], rounds).ok).toBe(true);
  });

  it('en verklig ändring av ROT-markeringen nekas fortfarande', () => {
    const rot = { ...b, is_rot_work: true };
    expect(validateLineItemEdit([a, b], [a, rot], rounds).ok).toBe(false);
    expect(validateLineItemEdit([a, rot], [a, b], rounds).ok).toBe(false);
  });

  // ── ROT-typen ──────────────────────────────────────────────────────────────
  //
  // Låstes när `house_work_type` blev redigerbart på arbetsordern. Typen ÄR ROT-identiteten — den
  // säger Skatteverket vilket slags husarbete som utförts — så en ändring på en rad som redan gått
  // ut på faktura låter underlaget säga en sak och den utställda fakturan en annan.
  describe('typen av husarbete på en fakturerad rad', () => {
    const rotB = { ...b, is_rot_work: true, house_work_type: 'CONSTRUCTION' };

    it('nekas när raden är ROT-arbete', () => {
      const res = validateLineItemEdit([a, rotB], [a, { ...rotB, house_work_type: 'HVAC' }], rounds);
      expect(res.ok).toBe(false);
      expect((res as any).message).toMatch(/typen av husarbete kan inte ändras/);
    });

    it('oförändrad typ släpps igenom', () => {
      expect(validateLineItemEdit([a, rotB], [a, { ...rotB, quantity: '9' }], rounds).ok).toBe(true);
    });

    // 🧨 FALSK BLOCKERING 1: en rad sparad innan fältet fanns saknar det helt, och schemat fyller
    // i defaulten vid nästa sparning. En rå strängjämförelse hade läst '' ≠ 'CONSTRUCTION' som en
    // ändring och nekat en helt legitim antalssänkning på en gammal order.
    it('äldre rad utan fältet får defaulten utan att det räknas som ändring', () => {
      const legacy = { ...b, is_rot_work: true };
      const saved = { ...legacy, house_work_type: 'CONSTRUCTION', quantity: '2' };
      expect(validateLineItemEdit([a, legacy], [a, saved], rounds).ok).toBe(true);
    });

    // 🧨 FALSK BLOCKERING 2: utan ROT-flaggan läses typen aldrig (rotRowHouseWork returnerar null),
    // så där ändrar den ingenting och får inte spärra något.
    it('rad som inte är ROT-arbete spärras inte av typen', () => {
      const plain = { ...b, is_rot_work: false, house_work_type: 'CONSTRUCTION' };
      expect(validateLineItemEdit([a, plain], [a, { ...plain, house_work_type: 'HVAC' }], rounds).ok).toBe(true);
    });
  });

  // Benämning och radtext är MEDVETET olåsta: de är dokumenttext, inte radens identitet
  // (`article_number`) och inte vad den kostade. Att rätta ett namn på en pågående order är
  // vardag; att ändra pris eller artikel är det som skulle spräcka bokföringen.
  it('tillåter att benämning och radtext ändras på en fakturerad rad', () => {
    const dopt = { ...b, article_name: 'Ekovilla lösull – snedtak', line_note: 'Etapp 2' };
    expect(validateLineItemEdit([a, b], [a, dopt], rounds).ok).toBe(true);
  });
});

// ── Regressionsvakter från kodgranskningen ────────────────────────────────────
describe('rundor för rader UTAN id', () => {
  // Fyndet: en runda skrevs som {line_id: null, quantity, legacy_index} medan läsvägen för id-lösa
  // rader letar efter `index`. Fakturerat lästes tillbaka som 0 → samma antal kunde faktureras igen.
  it('läser tillbaka en runda som skrevs med index', () => {
    const utanId = [{ pricing_mode: 'item', unit_price: '100', quantity: '10' }];
    const state = computeInvoiceState(utanId, [{ line_quantities: [{ line_id: null, index: 0, quantity: 4 }] }]);
    expect(state[0].invoiced).toBe(4);
    expect(state[0].remaining).toBe(6);
  });

  // legacy_index är spårbarhet, inte nyckel — en post med BARA legacy_index får inte matcha.
  it('matchar inte på legacy_index', () => {
    const utanId = [{ pricing_mode: 'item', unit_price: '100', quantity: '10' }];
    const state = computeInvoiceState(utanId, [{ line_quantities: [{ line_id: null, legacy_index: 0, quantity: 4 } as any] }]);
    expect(state[0].invoiced).toBe(0);
  });
});

describe('validateLineItemEdit — pris och artikel låsta på fakturerad rad', () => {
  const a = { id: 'line-a', pricing_mode: 'item', unit_price: '200', quantity: '10' };
  const rounds = [{ line_quantities: [{ line_id: 'line-a', quantity: 4 }] }];

  it('nekar prisändring på en rad som redan fakturerats', () => {
    const res = validateLineItemEdit([a], [{ ...a, unit_price: '300' }], rounds);
    expect(res.ok).toBe(false);
    expect((res as any).message).toMatch(/pris, rabatt, artikel/);
  });

  it('nekar rabatt-, artikel- och ROT-ändring likaså', () => {
    expect(validateLineItemEdit([a], [{ ...a, discount_percent: '10' }], rounds).ok).toBe(false);
    expect(validateLineItemEdit([a], [{ ...a, article_number: '999' }], rounds).ok).toBe(false);
    expect(validateLineItemEdit([a], [{ ...a, is_rot_work: true }], rounds).ok).toBe(false);
  });

  it('tillåter samma ändringar på en OFAKTURERAD rad', () => {
    const b = { id: 'line-b', pricing_mode: 'item', unit_price: '200', quantity: '5' };
    expect(validateLineItemEdit([a, b], [a, { ...b, unit_price: '999', article_number: '111' }], rounds).ok).toBe(true);
  });

  // Avskrivning av en rad som redan fakturerats är också en förbjuden ändring: fakturan är utställd.
  it('nekar att en fakturerad rad skrivs av', () => {
    const res = validateLineItemEdit([a], [{ ...a, written_off: true }], rounds);
    expect(res.ok).toBe(false);
  });
});

// Regressionsskydd för buggen där delfakturans "Ert referensnummer" bar VÅRT ordernummer i stället
// för kundens märkning. Fältet heter YourOrderNumber på både order och faktura, vilket är precis
// varför de kunde krocka — namnet låter som ett ordernummer, men på ordern är det märkningen.
describe('partialInvoiceReferenceField', () => {
  it('speglar företagskundens märkning från orderhuvudet', () => {
    expect(partialInvoiceReferenceField('Projekt 4711')).toEqual({ YourOrderNumber: 'Projekt 4711' });
  });

  // På en ROT-order är samma fält fastighetsbeteckningen. Den ska också nå fakturan.
  it('speglar fastighetsbeteckningen på en ROT-order', () => {
    expect(partialInvoiceReferenceField('Haggården 6:3')).toEqual({ YourOrderNumber: 'Haggården 6:3' });
  });

  // ⚠️ Coercas, inte antas vara text: ett referensnummer som råkar vara rena siffror kan komma
  // tillbaka som number ur Fortnox-JSON:en, och `.trim()` på ett number hade kastat.
  it('coercar ett numeriskt referensnummer till text', () => {
    expect(partialInvoiceReferenceField(4711)).toEqual({ YourOrderNumber: '4711' });
  });

  // Tomt fält → nyckeln utelämnas helt. Fakturan är ny och har inget att rensa, och '' rensar
  // ändå ingenting i Fortnox — den hade bara varit brus i payloaden.
  it('utelämnar nyckeln när ordern saknar referensnummer', () => {
    expect(partialInvoiceReferenceField(null)).toEqual({});
    expect(partialInvoiceReferenceField(undefined)).toEqual({});
    expect(partialInvoiceReferenceField('')).toEqual({});
    expect(partialInvoiceReferenceField('   ')).toEqual({});
  });

  // ⛔ En ÅTERTAGEN märkning får inte speglas ut på en ny faktura. label_cleared betyder att
  // säljaren tömt den men att rensnings-PUT:en inte gått igenom — Fortnox-ordern bär alltså kvar
  // det gamla värdet. Orderbekräftelsen är redan skickad; fakturan är det inte.
  it('speglar inte en märkning som tömts men ännu inte rensats i Fortnox', () => {
    expect(partialInvoiceReferenceField('Projekt 4711', { labelCleared: true })).toEqual({});
  });

  // ⚠️ Undantaget: på en ROT-order ÄR värdet fastighetsbeteckningen, inte en märkning. Den får inte
  // försvinna för att en märkning tömts — samma regel som orderReferenceNumberField bär.
  it('behåller fastighetsbeteckningen trots en tömd märkning', () => {
    expect(partialInvoiceReferenceField('Haggården 6:3', { labelCleared: true, propertyDesignation: 'Haggården 6:3' }))
      .toEqual({ YourOrderNumber: 'Haggården 6:3' });
  });

  // Utan rensning ändrar beteckningen ingenting — den är bara ett undantag från suppressionen.
  it('speglar som vanligt när ingen rensning är på gång', () => {
    expect(partialInvoiceReferenceField('Projekt 4711', { labelCleared: false })).toEqual({ YourOrderNumber: 'Projekt 4711' });
    expect(partialInvoiceReferenceField('Projekt 4711', { labelCleared: null })).toEqual({ YourOrderNumber: 'Projekt 4711' });
  });
});

// Andra halvan av samma regel. resolveRotReference fyller exakt EN av referensfältet och notraden;
// delfakturan måste följa det beslutet, annars trycks fastighetsbeteckningen två gånger så fort
// referensnumret speglas ur ordern.
describe('partialInvoiceRotPropertyNote', () => {
  const villa = { property_designation: 'Haggården 6:3' };
  const brf = { property_designation: 'Haggården 6:3', brf_org_number: '769600-1234' };

  // Villa: beteckningen ÄR referensnumret och står redan i huvudet — ingen textrad.
  it('utelämnar notraden på en villa vars beteckning ordern redan bär', () => {
    expect(partialInvoiceRotPropertyNote(villa, true, 'Haggården 6:3')).toBeNull();
  });

  // ⚠️ Men bara när huvudet faktiskt bär den. Annars ska den stå kvar som textrad — hellre två
  // gånger än inte alls, den är underlaget för avdraget.
  it('behåller notraden när ordern saknar referensnummer', () => {
    expect(partialInvoiceRotPropertyNote(villa, true, undefined)).toBe('Fastighetsbeteckning: Haggården 6:3');
  });

  // 🧨 Och bara vid EXAKT träff. Bär ordern ett annat referensnummer — beteckningen rättad i CRM
  // efter en misslyckad header-synk, eller något ekonomi skrivit in för hand i Fortnox — hade en
  // ren sanningstest tagit bort raden och lämnat fakturan helt utan beteckning.
  it('behåller notraden när ordern bär ett ANNAT referensnummer', () => {
    expect(partialInvoiceRotPropertyNote(villa, true, 'Haggården 6:1')).toBe('Fastighetsbeteckning: Haggården 6:3');
    expect(partialInvoiceRotPropertyNote(villa, true, 'Projekt 4711')).toBe('Fastighetsbeteckning: Haggården 6:3');
  });

  // Ingen beteckning alls på en ROT-order: ingen rad att bygga, och inget att jämföra mot.
  it('ger null när ROT-uppgifterna saknar beteckning', () => {
    expect(partialInvoiceRotPropertyNote({}, true, 'Projekt 4711')).toBeNull();
  });

  // Bostadsrätt: två värden ryms inte i ett fält, så de rider som textrad — precis som på ordern.
  // Notraden ska stå kvar även om huvudet bär något.
  it('behåller notraden på en bostadsrätt', () => {
    expect(partialInvoiceRotPropertyNote(brf, true, 'Haggården 6:3'))
      .toBe('Fastighetsbeteckning: Haggården 6:3  BRF org.nr: 769600-1234');
  });

  it('ger null när ordern inte är ROT', () => {
    expect(partialInvoiceRotPropertyNote(villa, false, undefined)).toBeNull();
    expect(partialInvoiceRotPropertyNote(null, false, undefined)).toBeNull();
  });
});
