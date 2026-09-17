import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  DEFAULT_ORDER_EMAIL,
  ORDER_EMAIL_LANGUAGES,
  ORDER_EMAIL_PLACEHOLDERS,
  describeOrderEmailTemplateProblem,
  effectiveOrderEmailTemplate,
  exampleOrderEmailData,
  formatOrderDate,
  renderOrderEmail,
  validateOrderEmailTemplate,
  type OrderEmailData,
  type OrderEmailTemplate,
} from '@/lib/domains/planning/materialOrderEmail';
import { sacksPerPalletFor } from '@/lib/domains/crm/materials';

// Beställningsmailets mall. Det här är texten som går till fabriken — ett fel här är ett fel i en
// beställning, inte i ett gränssnitt.

// 🧨 Härledda ur katalogen, inte handskrivna: ändras packningen ska testet räkna om sig.
const EKO_PALL = sacksPerPalletFor('EKOVILLA')!;
const KNAUF_PALL = sacksPerPalletFor('KNAUF SUPAFIL')!;

const data = (over: Partial<OrderEmailData> = {}): OrderEmailData => ({
  orderNumber: 14,
  supplierName: 'Ekovilla Oy',
  contactName: 'Pekka',
  senderName: 'William Ali',
  message: null,
  depots: [
    {
      depotName: 'Sandviken Lager',
      address: 'Industrivägen 1, Sandviken',
      deliveryDate: '2026-09-24',
      items: [
        { material: 'EKOVILLA', sacks: 4 * EKO_PALL },
        { material: 'PAROC', sacks: 87 },
      ],
    },
  ],
  otherLines: [],
  ...over,
});

function render(template: OrderEmailTemplate, language: 'sv' | 'en', d: OrderEmailData = data()) {
  const r = renderOrderEmail(template, language, d);
  if (!r.ok) throw new Error(`mallen avvisades: ${r.problems.map((p) => p.kind).join(', ')}`);
  return r.email;
}

describe('förutsättningar', () => {
  it('katalogen bär pallstorlekarna testerna räknar på, och PAROC saknar en', () => {
    expect(EKO_PALL).toBeGreaterThan(0);
    expect(KNAUF_PALL).toBeGreaterThan(0);
    expect(sacksPerPalletFor('PAROC')).toBeNull();
  });
});

describe('standardtexterna', () => {
  it.each(ORDER_EMAIL_LANGUAGES)('%s är en giltig mall', (lang) => {
    expect(validateOrderEmailTemplate(DEFAULT_ORDER_EMAIL[lang])).toEqual([]);
  });

  it('det finns en standardtext för varje språk', () => {
    expect(Object.keys(DEFAULT_ORDER_EMAIL).sort()).toEqual([...ORDER_EMAIL_LANGUAGES].sort());
  });
});

describe('effectiveOrderEmailTemplate', () => {
  it('null ger standardtexten för leverantörens språk', () => {
    expect(effectiveOrderEmailTemplate({ order_email_language: 'en', order_email_subject: null, order_email_body: null })).toBe(
      DEFAULT_ORDER_EMAIL.en,
    );
  });

  it('en anpassad mall används som den är', () => {
    const t = effectiveOrderEmailTemplate({ order_email_language: 'sv', order_email_subject: 'Ä #{ordernummer}', order_email_body: 'T {orderrader}' });
    expect(t).toEqual({ subject: 'Ä #{ordernummer}', body: 'T {orderrader}' });
  });

  it('en halv mall blir standardtexten, aldrig en blandning', () => {
    const t = effectiveOrderEmailTemplate({ order_email_language: 'sv', order_email_subject: 'Eget #{ordernummer}', order_email_body: null });
    expect(t).toBe(DEFAULT_ORDER_EMAIL.sv);
  });
});

describe('validering', () => {
  const ok: OrderEmailTemplate = { subject: 'Order #{ordernummer}', body: 'Hej\n\n{orderrader}' };
  const kinds = (t: OrderEmailTemplate) => validateOrderEmailTemplate(t).map((p) => p.kind);

  it('förutsättning: grundmallen är giltig', () => {
    expect(kinds(ok)).toEqual([]);
  });

  /** 🧨 En felstavning hade annars gått till fabriken ordagrant. */
  it('okänd platshållare avvisas, med namnet och fältet', () => {
    expect(validateOrderEmailTemplate({ ...ok, body: 'Hej {kontaktpersn}\n{orderrader}' })).toEqual([
      { kind: 'unknown_placeholder', field: 'body', name: 'kontaktpersn' },
    ]);
    expect(validateOrderEmailTemplate({ ...ok, subject: 'Order #{ordernumer} #{ordernummer}' })).toEqual([
      { kind: 'unknown_placeholder', field: 'subject', name: 'ordernumer' },
    ]);
  });

  it('klamrar kring annat än bokstäver är text, inte platshållare', () => {
    expect(kinds({ ...ok, body: 'Pris {12 st} och {} och {a b}\n{orderrader}' })).toEqual([]);
  });

  it('{orderrader} krävs i texten', () => {
    expect(kinds({ ...ok, body: 'Hej' })).toEqual(['lines_missing']);
  });

  it('{orderrader} får bara stå en gång', () => {
    expect(kinds({ ...ok, body: '{orderrader}\n{orderrader}' })).toEqual(['lines_repeated']);
  });

  it('{orderrader} kan inte stå i ämnet', () => {
    expect(kinds({ ...ok, subject: '#{ordernummer} {orderrader}' })).toContain('lines_in_subject');
  });

  it('{ordernummer} krävs i ämnet', () => {
    expect(kinds({ ...ok, subject: 'Beställning' })).toEqual(['order_number_missing_in_subject']);
  });

  it('ämnet måste vara en rad', () => {
    expect(kinds({ ...ok, subject: 'Order #{ordernummer}\nBcc: x@y.z' })).toContain('subject_multiline');
    expect(kinds({ ...ok, subject: 'Order #{ordernummer}\rX' })).toContain('subject_multiline');
  });

  it('tomma fält och för långa fält', () => {
    expect(kinds({ subject: '  ', body: ' ' })).toEqual(expect.arrayContaining(['subject_empty', 'body_empty']));
    expect(kinds({ ...ok, subject: `#{ordernummer}${'x'.repeat(200)}` })).toContain('subject_too_long');
    expect(kinds({ ...ok, body: `{orderrader}${'x'.repeat(5000)}` })).toContain('body_too_long');
  });

  it('varje problem har en svensk text', () => {
    const all = validateOrderEmailTemplate({ subject: `x{foo}\n${'y'.repeat(200)} {orderrader}`, body: '' });
    expect(all.length).toBeGreaterThan(3);
    for (const p of all) expect(describeOrderEmailTemplateProblem(p)).toMatch(/\S/);
  });
});

describe('orderraderna — systemets del av mailet', () => {
  it('svenska: depå, adress, datum, pall och säck', () => {
    const { text } = render(DEFAULT_ORDER_EMAIL.sv, 'sv');
    expect(text).toContain('SANDVIKEN LAGER – leverans senast torsdag 24 september');
    expect(text).toContain('Leveransadress: Industrivägen 1, Sandviken');
    expect(text).toContain(`- EKOVILLA: 4 pall (${4 * EKO_PALL} säck)`);
    // Okänd pallstorlek: säckar, aldrig ett påhittat pallantal.
    expect(text).toContain('- PAROC: 87 säck');
  });

  it('engelska: samma rader på engelska, med singular och plural', () => {
    const { text } = render(
      DEFAULT_ORDER_EMAIL.en,
      'en',
      data({
        depots: [
          {
            depotName: 'Sandviken Lager',
            address: 'Industrivägen 1',
            deliveryDate: '2026-09-24',
            items: [
              { material: 'EKOVILLA', sacks: EKO_PALL },
              { material: 'PAROC', sacks: 1 },
            ],
          },
        ],
      }),
    );
    expect(text).toContain('SANDVIKEN LAGER – delivery by Thursday 24 September');
    expect(text).toContain('Delivery address: Industrivägen 1');
    expect(text).toContain(`- EKOVILLA: 1 pallet (${EKO_PALL} bags)`);
    // Hel rad, inte delsträng: '1 bag' finns också i '1 bags'.
    expect(text).toMatch(/^- PAROC: 1 bag$/m);
    // Och plural åt andra hållet.
    expect(render(DEFAULT_ORDER_EMAIL.en, 'en').text).toContain(`- EKOVILLA: 4 pallets (${4 * EKO_PALL} bags)`);
    expect(render(DEFAULT_ORDER_EMAIL.en, 'en').text).toContain('- PAROC: 87 bags');
  });

  it('materialkoderna skrivs tecken för tecken, även med mellanslag och snedstreck', () => {
    const { text } = render(
      DEFAULT_ORDER_EMAIL.sv,
      'sv',
      data({
        depots: [
          {
            depotName: 'Borlänge',
            address: 'X',
            deliveryDate: '2026-09-24',
            items: [
              { material: 'KNAUF SUPAFIL', sacks: 2 * KNAUF_PALL },
              { material: 'ISOCELL/ISECO', sacks: 30 },
            ],
          },
        ],
      }),
    );
    expect(text).toContain(`- KNAUF SUPAFIL: 2 pall (${2 * KNAUF_PALL} säck)`);
    expect(text).toContain('- ISOCELL/ISECO: 30 säck');
  });

  it('ett antal som inte är hela pallar skrivs i säckar — aldrig ett avrundat pallantal', () => {
    const { text } = render(
      DEFAULT_ORDER_EMAIL.sv,
      'sv',
      data({ depots: [{ depotName: 'A', address: 'X', deliveryDate: '2026-09-24', items: [{ material: 'EKOVILLA', sacks: EKO_PALL + 1 }] }] }),
    );
    expect(text).toContain(`- EKOVILLA: ${EKO_PALL + 1} säck`);
    expect(text).not.toContain('pall');
  });

  it('flera depåer får var sitt block, i indatans ordning', () => {
    const { text } = render(DEFAULT_ORDER_EMAIL.sv, 'sv', exampleOrderEmailData({ name: 'Ekovilla Oy', contactName: null }, 'William'));
    expect(text.indexOf('EXEMPELDEPÅ SYD')).toBeGreaterThan(-1);
    expect(text.indexOf('EXEMPELDEPÅ NORR')).toBeGreaterThan(text.indexOf('EXEMPELDEPÅ SYD'));
  });

  it('övrigt på lasset kommer efter depåerna, med depån när den finns', () => {
    const { text } = render(
      DEFAULT_ORDER_EMAIL.sv,
      'sv',
      data({ otherLines: [{ text: '2 rullar plast', depotName: 'Sandviken Lager' }, { text: 'Blåsslang', depotName: null }] }),
    );
    expect(text).toContain('Övrigt på lasset:\n- 2 rullar plast (Sandviken Lager)\n- Blåsslang');
    expect(text.indexOf('Övrigt på lasset')).toBeGreaterThan(text.indexOf('PAROC'));
  });
});

describe('platshållarna', () => {
  it('varje platshållare fylls — ingen klammer blir kvar', () => {
    const body = ORDER_EMAIL_PLACEHOLDERS.map((p) => `${p}=[{${p}}]`).join('\n');
    const { subject, text } = render({ subject: '#{ordernummer} {leverantör}', body }, 'sv', data({ message: 'Ring innan' }));
    expect(subject).toBe('#14 Ekovilla Oy');
    expect(text).not.toMatch(/\{[A-Za-zÅÄÖåäö]+\}/);
    expect(text).toContain('ordernummer=[14]');
    expect(text).toContain('kontaktperson=[Pekka]');
    expect(text).toContain('leverantör=[Ekovilla Oy]');
    expect(text).toContain('avsändare=[William Ali]');
    expect(text).toContain('meddelande=[Ring innan]');
    expect(text).toContain('leveransdatum=[torsdag 24 september]');
  });

  it('{kontaktperson} utan kontaktperson blir leverantörens namn', () => {
    const { text } = render(DEFAULT_ORDER_EMAIL.sv, 'sv', data({ contactName: '  ' }));
    expect(text.startsWith('Hej Ekovilla Oy,')).toBe(true);
  });

  it('{leveransdatum} blir första–sista dagen när depåerna har olika datum', () => {
    const two = data({
      depots: [
        { depotName: 'B', address: 'X', deliveryDate: '2026-10-02', items: [{ material: 'PAROC', sacks: 1 }] },
        { depotName: 'A', address: 'X', deliveryDate: '2026-09-30', items: [{ material: 'PAROC', sacks: 1 }] },
      ],
    });
    expect(render(DEFAULT_ORDER_EMAIL.sv, 'sv', two).subject).toBe('Materialbeställning #14 från Ekovilla – leverans 30 september–2 oktober');
    expect(render(DEFAULT_ORDER_EMAIL.en, 'en', two).subject).toBe('Material order #14 from Ekovilla – delivery 30 September–2 October');
  });

  it('{totalt} i pall bara när varje rad är hela pallar', () => {
    const allPallets = data({
      depots: [{ depotName: 'A', address: 'X', deliveryDate: '2026-09-24', items: [{ material: 'EKOVILLA', sacks: 2 * EKO_PALL }, { material: 'KNAUF SUPAFIL', sacks: KNAUF_PALL }] }],
    });
    expect(render(DEFAULT_ORDER_EMAIL.sv, 'sv', allPallets).text).toContain(`Totalt: 3 pall (${2 * EKO_PALL + KNAUF_PALL} säck)`);
    // Standarddatan har PAROC utan känd pall: summan skrivs i säckar.
    expect(render(DEFAULT_ORDER_EMAIL.sv, 'sv').text).toContain(`Totalt: ${4 * EKO_PALL + 87} säck`);
  });

  it('ett tomt meddelande tar bort sin rad och lämnar inget dubbelt hål', () => {
    const { text } = render(DEFAULT_ORDER_EMAIL.sv, 'sv', data({ message: '   ' }));
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).toContain('87 säck\n\nTotalt:');
  });

  /** Utan en tom rad runt sig döljs hålet inte av sammanslagningen — raden måste verkligen bort. */
  it('ett tomt meddelande mitt i ett stycke lämnar ingen tom rad efter sig', () => {
    const { text } = render({ subject: '#{ordernummer}', body: 'A\n{meddelande}\nB\n{orderrader}' }, 'sv', data({ message: null }));
    expect(text.startsWith('A\nB\n')).toBe(true);
  });

  it('ett meddelande med flera rader behåller sina radbrytningar i texten', () => {
    const { text } = render(DEFAULT_ORDER_EMAIL.sv, 'sv', data({ message: 'Rad ett\nRad två' }));
    expect(text).toContain('Rad ett\nRad två');
  });

  /** Header-injektion: ett värde med en radbrytning får aldrig bli en extra rad i ämnet. */
  it('värden i ämnet rensas från radbrytningar', () => {
    const { subject } = render(
      { subject: '#{ordernummer} till {kontaktperson} {meddelande}', body: '{orderrader}' },
      'sv',
      data({ contactName: 'Pekka\r\nBcc: angripare@example.com', message: 'a\nb' }),
    );
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toBe('#14 till Pekka Bcc: angripare@example.com a b');
  });

  it('en ogiltig mall renderas inte', () => {
    const r = renderOrderEmail({ subject: 'Utan nummer', body: 'Utan rader' }, 'sv', data());
    expect(r.ok).toBe(false);
  });
});

describe('aldrig i mailet', () => {
  /**
   * Mailet får bara veta det OrderEmailData bär. Läggs ett fält till (saldo, run-out, pris, kund) måste
   * det här testet ändras med flit — det är poängen.
   */
  it('indatan bär exakt de tillåtna fälten', () => {
    const d = exampleOrderEmailData({ name: 'X', contactName: null }, 'Y');
    expect(Object.keys(d).sort()).toEqual(['contactName', 'depots', 'message', 'orderNumber', 'otherLines', 'senderName', 'supplierName']);
    expect(Object.keys(d.depots[0]).sort()).toEqual(['address', 'deliveryDate', 'depotName', 'items']);
    expect(Object.keys(d.depots[0].items[0]).sort()).toEqual(['material', 'sacks']);
  });

  it('exempelmailet har ordernummer 0, så ett testmail inte kan förväxlas med en beställning', () => {
    expect(exampleOrderEmailData({ name: 'X', contactName: null }, 'Y').orderNumber).toBe(0);
  });
});

describe('datumen håller i varje zon och över sommartidsväxlingen', () => {
  // process.env.TZ biter vid körning. Återställs efteråt: variabeln är processglobal och en worker kör
  // flera filer.
  const original = process.env.TZ;
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  for (const zone of ['UTC', 'Europe/Stockholm', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    describe(zone, () => {
      beforeAll(() => {
        process.env.TZ = zone;
      });

      it('förutsättning: zonen är satt', () => {
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone === 'UTC' ? 'UTC' : zone);
      });

      it('höstens växling (25/10 2026) är söndag 25 oktober, inte lördagen före eller måndagen efter', () => {
        expect(formatOrderDate('2026-10-25', 'sv')).toBe('söndag 25 oktober');
        expect(formatOrderDate('2026-10-25', 'en')).toBe('Sunday 25 October');
      });

      it('vårens växling (29/3 2026)', () => {
        expect(formatOrderDate('2026-03-29', 'sv')).toBe('söndag 29 mars');
      });
    });
  }
});
