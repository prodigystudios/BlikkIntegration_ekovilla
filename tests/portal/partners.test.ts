import { describe, it, expect } from 'vitest';
import { isValidIdempotencyKey } from '@/lib/domains/portal/idempotency';
import { portalOutboxEventDetail, portalOutboxEventKind } from '@/lib/domains/portal/outboxView';
import {
  PORTAL_RESELLER_UUID,
  buildResellerInvitePayload,
  defaultInviteStore,
  describeInviteFailure,
  inviteAdminSchema,
  inviteStoreSchema,
  nextResellerInvitePayload,
  partnerEligibility,
  resellerInviteIdempotencyKey,
  resellerInviteOrderingKey,
  type PartnerCard,
} from '@/lib/domains/portal/partners';

/**
 * Partnern bjuds in från kundkortet (RESELLER_PORTAL_CRM_PLAN.md 10a, kontraktets flöde 5). Det rena:
 *   - vilka kort som kan bjudas in (företag, med kundnummer i Fortnox);
 *   - formulärets regler, och förvalen ur kortet;
 *   - 🧨 kroppen till portalen med kontraktets EXAKTA fältnamn, prövad mot exemplet i planen;
 *   - nästa försök tar företagets uppgifter ur förra försöket, aldrig ur klienten;
 *   - portalens nej i klartext.
 */

const RESELLER_ID = '6f1c2a9e-4b7d-4f0e-9a51-0c3d2e8b7a64';

function card(patch: Partial<PartnerCard> = {}): PartnerCard {
  return {
    id: 'card-1',
    customer_type: 'business',
    company_name: 'Beijer Bygg Gävle',
    organization_number: '556123-4567',
    fortnox_customer_id: '1234',
    phone: '026-12 34 56',
    email: 'Gavle@Exempel.se',
    visit_address: { street: 'Industrigatan 4', postal_code: '802 22', city: 'Gävle' },
    invoice_address: { street: 'Box 1', postal_code: '801 00', city: 'Gävle' },
    delivery_address: null,
    ...patch,
  };
}

describe('partnerEligibility', () => {
  it('ett företagskort med kundnummer kan bjudas in, med numret trimmat', () => {
    expect(partnerEligibility(card({ fortnox_customer_id: ' 1234 ' }))).toEqual({ ok: true, customerNumber: '1234' });
  });

  it('ett privatkundskort kan inte, inte heller med kundnummer', () => {
    expect(partnerEligibility(card({ customer_type: 'private' }))).toEqual({ ok: false, reason: 'not_business' });
  });

  it('ett kort utan kundnummer i Fortnox kan inte: företaget i portalen behöver numret', () => {
    expect(partnerEligibility(card({ fortnox_customer_id: null }))).toEqual({ ok: false, reason: 'no_fortnox_number' });
    expect(partnerEligibility(card({ fortnox_customer_id: '  ' }))).toEqual({ ok: false, reason: 'no_fortnox_number' });
  });
});

describe('formuläret', () => {
  const store = { name: ' Beijer Gävle ', street: '', postalCode: '', city: ' Gävle ', phone: '', email: '' };

  it('namn och ort krävs; resten får vara tomt, och allt trimmas', () => {
    expect(inviteStoreSchema.parse(store)).toEqual({ ...store, name: 'Beijer Gävle', city: 'Gävle' });
    expect(inviteStoreSchema.safeParse({ ...store, name: '  ' }).success).toBe(false);
    expect(inviteStoreSchema.safeParse({ ...store, city: '' }).success).toBe(false);
  });

  it('samma gränser som crm_portal_resellers', () => {
    expect(inviteStoreSchema.safeParse({ ...store, name: 'x'.repeat(200) }).success).toBe(true);
    expect(inviteStoreSchema.safeParse({ ...store, name: 'x'.repeat(201) }).success).toBe(false);
    expect(inviteStoreSchema.safeParse({ ...store, street: 'x'.repeat(201) }).success).toBe(false);
    expect(inviteStoreSchema.safeParse({ ...store, postalCode: 'x'.repeat(21) }).success).toBe(false);
    expect(inviteStoreSchema.safeParse({ ...store, city: 'x'.repeat(101) }).success).toBe(false);
  });

  it('företagets e-post är frivillig men måste vara en adress när den står där, och sparas med gemener', () => {
    expect(inviteStoreSchema.parse({ ...store, email: ' Info@Exempel.SE ' }).email).toBe('info@exempel.se');
    expect(inviteStoreSchema.safeParse({ ...store, email: 'inte en adress' }).success).toBe(false);
  });

  it('adminen kräver namn och en adress, med gemener: portalens inloggning skiljer inte på dem', () => {
    expect(inviteAdminSchema.parse({ name: ' Anna Berg ', email: ' Anna.Berg@Exempel.se ' })).toEqual({
      name: 'Anna Berg',
      email: 'anna.berg@exempel.se',
    });
    expect(inviteAdminSchema.safeParse({ name: '', email: 'a@b.se' }).success).toBe(false);
    expect(inviteAdminSchema.safeParse({ name: 'Anna', email: '' }).success).toBe(false);
    expect(inviteAdminSchema.safeParse({ name: 'Anna', email: 'anna' }).success).toBe(false);
  });

  it('förvalen kommer ur kortet: besöksadressen före fakturaadressen före leveransadressen', () => {
    expect(defaultInviteStore(card())).toEqual({
      name: 'Beijer Bygg Gävle',
      street: 'Industrigatan 4',
      postalCode: '802 22',
      city: 'Gävle',
      phone: '026-12 34 56',
      email: 'gavle@exempel.se',
    });
    expect(defaultInviteStore(card({ visit_address: null })).street).toBe('Box 1');
    expect(
      defaultInviteStore(card({ visit_address: { street: ' ', postal_code: null, city: '' }, invoice_address: null, delivery_address: { city: 'Sandviken' } }))
        .city,
    ).toBe('Sandviken');
    // Äldre rader har gatan som `street_address`.
    expect(defaultInviteStore(card({ visit_address: { street_address: 'Gamla vägen 1', city: 'Gävle' } })).street).toBe('Gamla vägen 1');
    expect(defaultInviteStore(card({ visit_address: null, invoice_address: null }))).toMatchObject({ street: '', postalCode: '', city: '' });
  });
});

describe('kroppen till portalen (flöde 5)', () => {
  // Exemplet i RESELLER_PORTAL_CRM_PLAN.md, "10a", ordagrant. Portalen bygger mot det.
  const CONTRACT_EXAMPLE = {
    resellerId: '6f1c2a9e-4b7d-4f0e-9a51-0c3d2e8b7a64',
    name: 'Beijer Bygg Gävle',
    organizationNumber: '556123-4567',
    address: { street: 'Industrigatan 4', postalCode: '802 22', city: 'Gävle' },
    phone: '026-12 34 56',
    email: 'gavle@exempel.se',
    ekovillaCustomerNumber: '1234',
    admin: { name: 'Anna Berg', email: 'anna.berg@exempel.se' },
  };

  it('🧨 har kontraktets fältnamn och ingenting annat', () => {
    const payload = buildResellerInvitePayload({
      resellerId: RESELLER_ID,
      store: defaultInviteStore(card()),
      organizationNumber: '556123-4567',
      customerNumber: '1234',
      admin: { name: 'Anna Berg', email: 'anna.berg@exempel.se' },
    });
    expect(payload).toEqual(CONTRACT_EXAMPLE);
    expect(Object.keys(payload).sort()).toEqual(Object.keys(CONTRACT_EXAMPLE).sort());
  });

  it('ett kort utan org.nr skickar en tom sträng, aldrig null', () => {
    const payload = buildResellerInvitePayload({
      resellerId: RESELLER_ID,
      store: defaultInviteStore(card()),
      organizationNumber: null,
      customerNumber: '1234',
      admin: { name: 'Anna Berg', email: 'anna.berg@exempel.se' },
    });
    expect(payload.organizationNumber).toBe('');
  });

  it('nyckeln är försökets och har samma form som tabellens check: reseller-invite-<id>-<n>', () => {
    expect(resellerInviteIdempotencyKey(RESELLER_ID, 1)).toBe(`reseller-invite-${RESELLER_ID}-1`);
    expect(resellerInviteIdempotencyKey(RESELLER_ID, 12)).toBe(`reseller-invite-${RESELLER_ID}-12`);
    expect(isValidIdempotencyKey(resellerInviteIdempotencyKey(RESELLER_ID, 1))).toBe(true);
    // Det längsta id:t crm_portal_resellers tillåter ryms också.
    expect(isValidIdempotencyKey(resellerInviteIdempotencyKey('x'.repeat(100), 999_999))).toBe(true);
  });

  it('id:t är ett uuid med gemener, som crypto.randomUUID ger', () => {
    expect(PORTAL_RESELLER_UUID.test(globalThis.crypto.randomUUID())).toBe(true);
    expect(PORTAL_RESELLER_UUID.test(RESELLER_ID.toUpperCase())).toBe(false);
    expect(PORTAL_RESELLER_UUID.test('res-norrbygg')).toBe(false);
  });
});

describe('nästa försök', () => {
  const previous = buildResellerInvitePayload({
    resellerId: RESELLER_ID,
    store: { name: 'Beijer Gävle', street: 'Industrigatan 4', postalCode: '802 22', city: 'Gävle', phone: '026-1', email: 'gavle@exempel.se' },
    organizationNumber: '556123-4567',
    customerNumber: '1234',
    admin: { name: 'Anna Berg', email: 'anna@exempel.se' },
  });
  const storeRow = { resellerId: RESELLER_ID, name: 'Annat namn', street: 'Annan gata', postalCode: '', city: 'Annan ort' };
  const admin = { name: 'Bo Ek', email: 'bo@exempel.se' };

  it('tar företagets uppgifter ur förra försöket och byter adminen och kortets nummer', () => {
    expect(nextResellerInvitePayload({ previous, store: storeRow, card: card({ fortnox_customer_id: '5678' }), customerNumber: '5678', admin })).toEqual({
      ...previous,
      ekovillaCustomerNumber: '5678',
      admin,
    });
  });

  it('utan ett läsbart förra försök: butikens rad och kortets telefon och e-post', () => {
    const expected = {
      resellerId: RESELLER_ID,
      name: 'Annat namn',
      organizationNumber: '556123-4567',
      address: { street: 'Annan gata', postalCode: '', city: 'Annan ort' },
      phone: '026-12 34 56',
      email: 'gavle@exempel.se',
      ekovillaCustomerNumber: '1234',
      admin,
    };
    for (const p of [undefined, null, { trasig: true }, { ...previous, resellerId: globalThis.crypto.randomUUID() }]) {
      expect(nextResellerInvitePayload({ previous: p, store: storeRow, card: card(), customerNumber: '1234', admin })).toEqual(expected);
    }
  });
});

describe('portalens nej i klartext', () => {
  const dead = (lastError: string | null, lastHttpStatus: number | null = 409) => ({ status: 'dead' as const, lastHttpStatus, lastError });
  const envelope = (code: string, error: string) => JSON.stringify({ ok: false, error, errorDetails: { code, message: error } });

  it('en adress som redan har ett konto i ett annat företag', () => {
    expect(describeInviteFailure(dead(`HTTP 409: ${envelope('admin_email_taken', 'E-postadressen används redan.')}`))).toBe(
      'Adressen har redan ett konto i ett annat företag i portalen. Bjud in med en annan adress.',
    );
  });

  it('ett annat nej: portalens egen text', () => {
    expect(describeInviteFailure(dead(`HTTP 422: ${envelope('invalid_request', 'Orten saknas.')}`, 422))).toBe(
      'Portalen nekade inbjudan: Orten saknas.',
    );
  });

  it('ett svar som inte går att läsa (kapat, eller ingen JSON): bara statusen', () => {
    expect(describeInviteFailure(dead('HTTP 400: {"ok":false,"err', 400))).toBe('Portalen nekade inbjudan (HTTP 400).');
    expect(describeInviteFailure(dead('HTTP 404: <html>', 404))).toBe('Portalen nekade inbjudan (HTTP 404).');
    expect(describeInviteFailure(dead('timeout', null))).toBe('Inbjudan gick inte fram till portalen.');
  });

  it('bara en uppgiven inbjudan har ett nej', () => {
    for (const status of ['pending', 'sending', 'sent', 'superseded', 'not_queued'] as const) {
      expect(describeInviteFailure({ status, lastHttpStatus: 503, lastError: 'HTTP 503: nere' })).toBeNull();
    }
  });
});

describe('fliken Utskick', () => {
  it('känner igen en inbjudan på köns nyckel och visar företaget och adminen', () => {
    const payload = buildResellerInvitePayload({
      resellerId: RESELLER_ID,
      store: defaultInviteStore(card()),
      organizationNumber: null,
      customerNumber: '1234',
      admin: { name: 'Anna Berg', email: 'anna@exempel.se' },
    });
    const kind = portalOutboxEventKind(resellerInviteOrderingKey(RESELLER_ID), payload);
    expect(kind).toBe('reseller.invite');
    expect(portalOutboxEventDetail(kind, payload)).toBe('Beijer Bygg Gävle · anna@exempel.se');
  });
});
