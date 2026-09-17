import { describe, it, expect } from 'vitest';
import {
  ORDER_LINES_MAX,
  ORDER_LINE_SACKS_MAX,
  buildOrderLines,
  classifySendError,
  describeOrderLineProblem,
  materialOrderAddresses,
  materialOrderIdempotencyKey,
  materialOrderSendMode,
  orderDeliveryState,
  orderEmailDataFromOrder,
  type OrderLineInput,
} from '@/lib/domains/planning/materialOrders';
import { DEFAULT_ORDER_EMAIL, renderOrderEmail } from '@/lib/domains/planning/materialOrderEmail';
import { MATERIAL_SHORTS, sacksPerPalletFor } from '@/lib/domains/crm/materials';
import type { OpsDepot } from '@/lib/domains/planning/types';

// Materialbeställningarnas rena regler. SQL-sidan (trigger, RLS, RPC:er) är provkörd för sig i Postgres.

const EKO = 'EKOVILLA';
const KNAUF = 'KNAUF SUPAFIL';
const PAROC = 'PAROC';
const EKO_PALL = sacksPerPalletFor(EKO)!;
const TODAY = '2026-09-17';
const SYD: OpsDepot = { id: 'd-syd', name: 'Sandviken Lager', location: 'Industrivägen 1, Sandviken', active: true };
const NORR: OpsDepot = { id: 'd-norr', name: 'Borlänge Lager', location: 'Lagergatan 2, Borlänge', active: true };
const supplier = { active: true, materials: [EKO, PAROC] };
const ctx = { supplier, depots: [SYD, NORR], today: TODAY };
const line = (over: Partial<OrderLineInput> = {}): OrderLineInput => ({
  depot_id: SYD.id,
  material: EKO,
  sacks: 4 * EKO_PALL,
  requested_on: '2026-10-01',
  ...over,
});
const kinds = (input: OrderLineInput[], c = ctx) => {
  const r = buildOrderLines(input, c);
  return r.ok ? [] : r.problems.map((p) => p.kind);
};

describe('förutsättningar', () => {
  it('katalogen bär materialen och pallstorlekarna testerna räknar på', () => {
    for (const m of [EKO, KNAUF, PAROC]) expect(MATERIAL_SHORTS).toContain(m);
    expect(EKO_PALL).toBeGreaterThan(1);
    expect(sacksPerPalletFor(PAROC)).toBeNull();
  });
});

describe('buildOrderLines', () => {
  it('kompletterar raderna med depåns namn, adress och pallstorlek ur registret', () => {
    const r = buildOrderLines([line(), line({ depot_id: NORR.id, material: PAROC, sacks: 87, requested_on: '2026-10-02' })], ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines[0]).toEqual({ ...line(), depot_name: SYD.name, depot_location: SYD.location, sacks_per_pallet: EKO_PALL });
    expect(r.lines[1].sacks_per_pallet).toBeNull();
  });

  /** Klienten skickar bara id:n. Ett depånamn eller en adress i anropet får aldrig nå mailet. */
  it('ett insmugglat depånamn eller en adress ignoreras', () => {
    const smuggled = { ...line(), depot_name: 'Angripare', depot_location: 'Någon annanstans' } as OrderLineInput;
    const r = buildOrderLines([smuggled], ctx);
    expect(r.ok && r.lines[0].depot_name).toBe(SYD.name);
    expect(r.ok && r.lines[0].depot_location).toBe(SYD.location);
  });

  it('inga rader, eller för många', () => {
    expect(kinds([])).toEqual(['no_lines']);
    const many = Array.from({ length: ORDER_LINES_MAX + 1 }, (_, i) => line({ depot_id: `x${i}` }));
    expect(kinds(many, { ...ctx, depots: many.map((l) => ({ ...SYD, id: l.depot_id })) })).toContain('too_many_lines');
  });

  it('en inaktiv leverantör vägras', () => {
    expect(kinds([line()], { ...ctx, supplier: { ...supplier, active: false } })).toEqual(['supplier_inactive']);
  });

  /** Materialet väljer mottagaren. Ett material leverantören inte för är en beställning till fel fabrik. */
  it('ett material leverantören inte levererar vägras, ett okänt likaså', () => {
    expect(kinds([line({ material: KNAUF, sacks: sacksPerPalletFor(KNAUF)! })])).toEqual(['material_not_supplied']);
    expect(kinds([line({ material: 'LÖSULL' })])).toEqual(['material_unknown']);
  });

  it('en depå utan Plats vägras — fabriken vet inte vart lasset ska', () => {
    expect(kinds([line()], { ...ctx, depots: [{ ...SYD, location: '  ' }] })).toEqual(['depot_without_location']);
    expect(kinds([line()], { ...ctx, depots: [{ ...SYD, location: null }] })).toEqual(['depot_without_location']);
  });

  it('en inaktiv eller okänd depå vägras', () => {
    expect(kinds([line()], { ...ctx, depots: [{ ...SYD, active: false }] })).toEqual(['depot_inactive']);
    expect(kinds([line({ depot_id: 'finns-inte' })])).toEqual(['depot_unknown']);
  });

  it('säckarna: positivt heltal, och hela pallar när storleken är känd', () => {
    expect(kinds([line({ sacks: 0 })])).toEqual(['sacks_invalid']);
    expect(kinds([line({ sacks: -54 })])).toEqual(['sacks_invalid']);
    expect(kinds([line({ sacks: 54.5 })])).toEqual(['sacks_invalid']);
    // Taket delas med databasen: ett större tal går inte att göra till en väntad leverans.
    expect(kinds([line({ material: PAROC, sacks: ORDER_LINE_SACKS_MAX })])).toEqual([]);
    expect(kinds([line({ material: PAROC, sacks: ORDER_LINE_SACKS_MAX + 1 })])).toEqual(['sacks_invalid']);
    expect(kinds([line({ sacks: EKO_PALL + 1 })])).toEqual(['sacks_not_pallets']);
    // Okänd pallstorlek: vilket heltal som helst.
    expect(kinds([line({ material: PAROC, sacks: 87 })])).toEqual([]);
  });

  it('datumet: idag går, igår vägras, skräp vägras', () => {
    expect(kinds([line({ requested_on: TODAY })])).toEqual([]);
    expect(kinds([line({ requested_on: '2026-09-16' })])).toEqual(['date_in_past']);
    expect(kinds([line({ requested_on: '2026-13-45' })])).toEqual(['date_invalid']);
    expect(kinds([line({ requested_on: '1 oktober' })])).toEqual(['date_invalid']);
    // 🧨 Date.parse rullar över omöjliga datum i stället för att fela. Mailet hade sagt en annan dag.
    expect(kinds([line({ requested_on: '2027-02-29' })])).toEqual(['date_invalid']);
    expect(kinds([line({ requested_on: '2026-04-31' })])).toEqual(['date_invalid']);
    expect(kinds([line({ requested_on: '2028-02-29' })])).toEqual([]); // skottår
  });

  it('samma depå och material två gånger vägras', () => {
    expect(kinds([line(), line()])).toEqual(['duplicate_line']);
    // Samma material till två depåer är två rader, inte en dubblett.
    expect(kinds([line(), line({ depot_id: NORR.id })])).toEqual([]);
  });

  it('en depå får ett datum per beställning', () => {
    expect(kinds([line(), line({ material: PAROC, sacks: 10, requested_on: '2026-10-05' })])).toEqual(['depot_dates_differ']);
  });

  it('samma problem på flera rader rapporteras en gång', () => {
    const r = buildOrderLines([line(), line({ material: PAROC, sacks: 10 })], { ...ctx, depots: [{ ...SYD, location: null }] });
    expect(r.ok ? [] : r.problems).toEqual([{ kind: 'depot_without_location', depot_name: SYD.name }]);
  });

  it('varje problem har en svensk text', () => {
    const r = buildOrderLines(
      [line({ depot_id: 'x' }), line({ sacks: 1, requested_on: 'x', material: 'Q' }), line({ requested_on: '2020-01-01', sacks: 0 })],
      { ...ctx, supplier: { active: false, materials: [] }, depots: [{ ...SYD, location: null, active: false }] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) for (const p of r.problems) expect(describeOrderLineProblem(p)).toMatch(/\S/);
  });
});

describe('orderEmailDataFromOrder', () => {
  it('grupperar per depå i den ordning depåerna först förekommer, och renderar', () => {
    const r = buildOrderLines(
      [line({ depot_id: NORR.id, requested_on: '2026-10-02' }), line(), line({ depot_id: NORR.id, material: PAROC, sacks: 87, requested_on: '2026-10-02' })],
      ctx,
    );
    if (!r.ok) throw new Error('förutsättning: raderna är giltiga');
    const data = orderEmailDataFromOrder({
      order_no: 14,
      supplier_name: 'Ekovilla Oy',
      contact_name: null,
      sender_name: 'William',
      message: null,
      lines: r.lines,
      other_lines: [],
    });
    expect(data.depots.map((d) => d.depotName)).toEqual([NORR.name, SYD.name]);
    expect(data.depots[0].items).toEqual([
      { material: EKO, sacks: 4 * EKO_PALL },
      { material: PAROC, sacks: 87 },
    ]);
    expect(data.depots[0].address).toBe(NORR.location);
    const rendered = renderOrderEmail(DEFAULT_ORDER_EMAIL.sv, 'sv', data);
    expect(rendered.ok && rendered.email.subject).toBe('Materialbeställning #14 från Ekovilla – leverans 1 oktober–2 oktober');
  });
});

describe('materialOrderSendMode', () => {
  /** 🧨 Lokala dev-servern har en skarp nyckel och pekar på produktionsdatan. */
  it('live BARA i Vercels produktion med flaggan på', () => {
    expect(materialOrderSendMode({ VERCEL_ENV: 'production', MATERIAL_ORDER_SEND_ENABLED: 'true' })).toBe('live');
  });

  it.each([
    [{}],
    [{ MATERIAL_ORDER_SEND_ENABLED: 'true' }],
    [{ NODE_ENV: 'production', MATERIAL_ORDER_SEND_ENABLED: 'true' }],
    [{ VERCEL_ENV: 'preview', NODE_ENV: 'production', MATERIAL_ORDER_SEND_ENABLED: 'true' }],
    [{ VERCEL_ENV: 'development', MATERIAL_ORDER_SEND_ENABLED: 'true' }],
    [{ VERCEL_ENV: 'production' }],
    [{ VERCEL_ENV: 'production', MATERIAL_ORDER_SEND_ENABLED: 'TRUE' }],
    [{ VERCEL_ENV: 'production', MATERIAL_ORDER_SEND_ENABLED: '1' }],
  ])('blockerat för %o', (env) => {
    expect(materialOrderSendMode(env as Record<string, string>)).toBe('blocked');
  });
});

describe('classifySendError', () => {
  it.each(['validation_error', 'missing_required_field', 'invalid_from_address', 'rate_limit_exceeded', 'not_configured', 'invalid_idempotency_key'])(
    '%s bevisar att inget skickades',
    (code) => {
      expect(classifySendError(code)).toBe('rejected');
    },
  );

  /** Allt som inte bevisar ett avslag är oklart. En gissning åt andra hållet = ny nyckel = två mail. */
  it.each(['application_error', 'internal_server_error', 'service_unavailable', 'invalid_idempotent_request', 'concurrent_idempotent_requests', 'unknown_error', 'något_nytt', '', null, undefined])(
    '%s är oklart',
    (code) => {
      expect(classifySendError(code as string | null | undefined)).toBe('ambiguous');
    },
  );
});

describe('idempotensnyckeln och adresserna', () => {
  /** Låst till en literal: en tidsstämpel i nyckeln hade klarat en jämförelse av två anrop i samma millisekund. */
  it('nyckeln är exakt material-order/<id>/<försök>', () => {
    expect(materialOrderIdempotencyKey('o1', 1)).toBe('material-order/o1/1');
    expect(materialOrderIdempotencyKey('4f6c1a2b-0000-4000-8000-000000000001', 3)).toBe('material-order/4f6c1a2b-0000-4000-8000-000000000001/3');
  });

  it('samma order och försök ger samma nyckel, ett nytt försök en ny', () => {
    expect(materialOrderIdempotencyKey('o1', 1)).toBe(materialOrderIdempotencyKey('o1', 1));
    expect(materialOrderIdempotencyKey('o1', 2)).not.toBe(materialOrderIdempotencyKey('o1', 1));
    expect(materialOrderIdempotencyKey('o2', 1)).not.toBe(materialOrderIdempotencyKey('o1', 1));
    // Bara tecken under U+0100 — annat kastar SDK:n när headern byggs.
    expect(materialOrderIdempotencyKey('4f6c-uuid', 3)).toMatch(/^[\x20-\x7e]+$/);
  });

  it('från, svar till och kopia går till order@, med valbar avsändare', () => {
    expect(materialOrderAddresses({})).toEqual({ from: 'Ekovilla <order@ekovilla.se>', replyTo: 'order@ekovilla.se', bcc: 'order@ekovilla.se' });
    expect(materialOrderAddresses({ MATERIAL_ORDER_MAIL_FROM: ' Ekovilla Order <order@ekovilla.se> ' }).from).toBe('Ekovilla Order <order@ekovilla.se>');
  });
});

describe('orderDeliveryState', () => {
  const r = (status: 'expected' | 'arrived' | 'cancelled') => ({ status });
  it('härleds ur de väntade leveranserna', () => {
    expect(orderDeliveryState([])).toBe('none');
    expect(orderDeliveryState([r('expected'), r('expected')])).toBe('waiting');
    expect(orderDeliveryState([r('arrived'), r('expected')])).toBe('partial');
    expect(orderDeliveryState([r('arrived'), r('arrived')])).toBe('arrived');
    expect(orderDeliveryState([r('cancelled'), r('cancelled')])).toBe('cancelled');
  });

  it('en avbokad rad räknas varken som framme eller väntad', () => {
    expect(orderDeliveryState([r('arrived'), r('cancelled')])).toBe('arrived');
    expect(orderDeliveryState([r('expected'), r('cancelled')])).toBe('waiting');
  });
});
