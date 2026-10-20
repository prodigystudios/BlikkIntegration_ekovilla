import { describe, it, expect } from 'vitest';
import {
  buildWorkOrderCustomerSwapUpdate,
  currentJobSite,
  customerSwapBlock,
  customerSwapBlockMessage,
  customerSwapReadinessBlockers,
  customerSwapInvoicingStarted,
  defaultWorkAddressChoice,
  orderReverseVat,
  type SwapCustomerCard,
  type SwappableWorkOrder,
} from '@/lib/domains/crm/workOrderCustomerSwap';

// Byta kund på arbetsordern (William, 2026-10-20): fram till första fakturan, bara samma kundtyp och
// moms, offerten står kvar, kontakten blir den nya kundens och arbetsadressen väljs i dialogen.

const privateOrder: SwappableWorkOrder = {
  id: 'wo-1',
  status: 'scheduled',
  assigned_to: 'seller-1',
  quote_id: 'quote-1',
  customer_id: 'cust-old',
  prospect_id: null,
  quote_type: 'private',
  customer_snapshot: {
    customer_name: 'Erik Johansson',
    personal_number: '19860801-7557',
    contact_name: 'Erik Johansson',
    email: 'erik@x.se',
    phone: '0701111111',
    your_reference: 'Erik Johansson',
    street_address: 'Sergutt 23',
    postal_code: '14232',
    city: 'Svante',
    visit_address: 'Sergutt 23, 14232 Svante',
    invoice_address: 'Box 1',
    end_contact_name: 'Grannen',
    label: null,
    reverse_vat: false,
  },
  work_address: { street_address: 'Sergutt 23', postal_code: '14232', city: 'Svante', delivery_address: null, invoice_address: null },
  rot_details: { enabled: true, applicant_name: 'Erik Johansson', personal_number: '19860801-7557', property_designation: 'Svante 1:2', rot_percent: 30, max_deduction: 50000 },
  line_items: [{ id: 'a', article_name: 'Ekovilla', quantity: '10', unit_price: '100' }],
  internal_handoff: {},
  fortnox_order_number: '109',
  updated_at: '2026-10-20T08:00:00Z',
};

const perSeppa: SwapCustomerCard = {
  id: 'cust-new',
  customer_type: 'private',
  company_name: null,
  organization_number: null,
  first_name: 'Per',
  last_name: 'Seppä',
  personal_number: '19930512-3235',
  email: 'info@persappa.se',
  phone: '0723239123',
  mobile: null,
  visit_address: { street: 'Testvägen 1', postal_code: '15232', city: 'Söder' },
  contacts: [],
  reverse_vat: false,
  fortnox_customer_id: '4',
};

const ctx = { invoiced: false, isPortalJob: false, currentReverseVat: false };

describe('customerSwapBlock', () => {
  it('samma typ och moms, ofakturerad: tillåtet', () => {
    expect(customerSwapBlock(privateOrder, perSeppa, ctx)).toBeNull();
  });

  it('samma kund', () => {
    expect(customerSwapBlock(privateOrder, { ...perSeppa, id: 'cust-old' }, ctx)).toBe('same_customer');
  });

  it('avbruten order', () => {
    expect(customerSwapBlock({ ...privateOrder, status: 'cancelled' }, perSeppa, ctx)).toBe('cancelled');
  });

  // Fakturan har gått till den nuvarande kunden — en del eller allt.
  it('faktureringen har börjat', () => {
    expect(customerSwapBlock(privateOrder, perSeppa, { ...ctx, invoiced: true })).toBe('invoiced');
  });

  it('Fortnox-ordern makulerad i Fortnox', () => {
    expect(customerSwapBlock(privateOrder, perSeppa, { ...ctx, fortnoxCancelled: true })).toBe('fortnox_cancelled');
  });

  it('portalorder', () => {
    expect(customerSwapBlock(privateOrder, perSeppa, { ...ctx, isPortalJob: true })).toBe('portal');
  });

  it('privat ↔ företag nekas', () => {
    expect(customerSwapBlock(privateOrder, { ...perSeppa, customer_type: 'business' }, ctx)).toBe('customer_type');
  });

  it('omvänd skattskyldighet ↔ vanlig moms nekas, åt båda hållen', () => {
    const business = { ...privateOrder, quote_type: 'business' as const };
    const builder = { ...perSeppa, customer_type: 'business' as const, reverse_vat: true };
    expect(customerSwapBlock(business, builder, ctx)).toBe('reverse_vat');
    expect(customerSwapBlock(business, { ...builder, reverse_vat: false }, { ...ctx, currentReverseVat: true })).toBe('reverse_vat');
    expect(customerSwapBlock(business, builder, { ...ctx, currentReverseVat: true })).toBeNull();
  });

  // Omvänd byggmoms gäller aldrig en privatperson — ett felaktigt kryss på ett privatkort spärrar inte.
  it('momsflaggan prövas inte för privatkunder', () => {
    expect(customerSwapBlock(privateOrder, { ...perSeppa, reverse_vat: true }, ctx)).toBeNull();
  });

  it('meddelandet säger vad ordern har', () => {
    expect(customerSwapBlockMessage('reverse_vat', { quote_type: 'business', reverseVat: true })).toMatch(/Ordern har omvänd skattskyldighet, den nya kunden vanlig moms/);
    expect(customerSwapBlockMessage('customer_type', { quote_type: 'private', reverseVat: false })).toMatch(/gäller en privatkund/);
  });
});

describe('arbetsplatsen', () => {
  it('currentJobSite: kolumnen, annars snapshotens arbetsadress, annars kundens adress — som en enhet', () => {
    expect(currentJobSite(privateOrder)).toEqual({ street_address: 'Sergutt 23', postal_code: '14232', city: 'Svante' });
    const noColumn = { ...privateOrder, work_address: null, customer_snapshot: { ...privateOrder.customer_snapshot, delivery_address: 'Stugan 2', delivery_postal_code: null, delivery_city: 'Mora' } };
    expect(currentJobSite(noColumn)).toEqual({ street_address: 'Stugan 2', postal_code: null, city: 'Mora' });
    expect(currentJobSite({ ...privateOrder, work_address: {} })).toEqual({ street_address: 'Sergutt 23', postal_code: '14232', city: 'Svante' });
  });

  it('förvalet: den gamla kundens egen adress → den nya kundens', () => {
    expect(defaultWorkAddressChoice(privateOrder)).toBe('customer');
  });

  it('förvalet: en egen arbetsplats behålls', () => {
    expect(defaultWorkAddressChoice({ ...privateOrder, work_address: { street_address: 'Byggplatsen 9', postal_code: '11122', city: 'Stockholm' } })).toBe('keep');
  });

  it('förvalet: ingen arbetsplats alls → den nya kundens', () => {
    expect(defaultWorkAddressChoice({ ...privateOrder, work_address: {}, customer_snapshot: {} })).toBe('customer');
  });
});

describe('buildWorkOrderCustomerSwapUpdate', () => {
  const build = (order = privateOrder, card = perSeppa, workAddress: 'keep' | 'customer' = 'customer', fallbackRot: Record<string, unknown> | null = null) =>
    buildWorkOrderCustomerSwapUpdate(order, card, { workAddress, fallbackRot, fortnoxCustomerNumber: '4' });

  it('kunden, namnet och det förväntade Fortnox-numret', () => {
    const update = build();
    expect(update.customer_id).toBe('cust-new');
    expect(update.client_name).toBe('Per Seppä');
    expect((update.customer_snapshot as Record<string, unknown>).fortnox_customer_number).toBe('4');
  });

  // Kontakten löses som när kunden väljs på en offert (resolveCrmContact): ett kort utan kontaktrader
  // ger ingen kontaktperson, men kortets telefon och e-post. Den gamla kundens namn får aldrig stå kvar.
  it('identiteten och kontakten blir den nya kundens', () => {
    expect(build().customer_snapshot).toMatchObject({
      customer_name: 'Per Seppä',
      personal_number: '19930512-3235',
      contact_name: null,
      email: 'info@persappa.se',
      phone: '0723239123',
      your_reference: null,
      street_address: 'Testvägen 1',
      postal_code: '15232',
      city: 'Söder',
      reverse_vat: false,
    });
  });

  it('kortets primärkontakt blir kundkontakt och Er referens', () => {
    const card = { ...perSeppa, contacts: [{ name: 'Lena Seppä', phone: '0709999999', email: 'lena@x.se', is_primary: true }] };
    expect(build(privateOrder, card).customer_snapshot).toMatchObject({ contact_name: 'Lena Seppä', phone: '0709999999', email: 'lena@x.se', your_reference: 'Lena Seppä' });
  });

  // Den gamla kundens fria adressfält ur offerten får inte följa med.
  it('den gamla kundens besöks- och fakturaadress töms', () => {
    expect(build().customer_snapshot).toMatchObject({ visit_address: null, invoice_address: null });
  });

  it('jobbets fält står kvar: kontakten på plats och märkningen', () => {
    const order = { ...privateOrder, customer_snapshot: { ...privateOrder.customer_snapshot, label: 'Hus B' } };
    expect(build(order).customer_snapshot).toMatchObject({ end_contact_name: 'Grannen', label: 'Hus B' });
  });

  it('kundtyp, moms och priser rörs inte', () => {
    const update = build();
    for (const key of ['quote_type', 'vat_percent', 'pricing_summary', 'amount', 'line_items']) expect(update).not.toHaveProperty(key);
  });

  it('den nya kundens adress: kolumnen får kortets, och ingen separat arbetsadress i snapshoten', () => {
    const update = build(privateOrder, perSeppa, 'customer');
    expect(update.work_address).toMatchObject({ street_address: 'Testvägen 1', postal_code: '15232', city: 'Söder' });
    expect(update.customer_snapshot).toMatchObject({ delivery_address: null, delivery_postal_code: null, delivery_city: null });
  });

  // 🧨 Utan den uttryckliga kolumnen hade en order som läser arbetsplatsen ur snapshotens kundadress
  // flyttat med kunden — installatörerna till fel hus.
  it('behåll: arbetsplatsen skrivs ut i kolumnen och blir snapshotens arbetsadress', () => {
    const legacy = { ...privateOrder, work_address: null };
    const update = build(legacy, perSeppa, 'keep');
    expect(update.work_address).toMatchObject({ street_address: 'Sergutt 23', postal_code: '14232', city: 'Svante' });
    expect(update.customer_snapshot).toMatchObject({ delivery_address: 'Sergutt 23', delivery_postal_code: '14232', delivery_city: 'Svante' });
  });

  it('behåll en arbetsplats som råkar vara den nya kundens adress: ingen separat arbetsadress', () => {
    const order = { ...privateOrder, work_address: { street_address: 'testvägen 1', postal_code: '15232', city: 'Söder' } };
    expect(build(order, perSeppa, 'keep').customer_snapshot).toMatchObject({ delivery_address: null });
  });

  it('ROT-sökanden blir den nya kunden, resten av ROT-uppgifterna står kvar', () => {
    expect(build().rot_details).toEqual({ ...privateOrder.rot_details, applicant_name: 'Per Seppä', personal_number: '19930512-3235' });
  });

  // 🧨 Tomma ROT-uppgifter på ordern läser OFFERTENS, och offerten står kvar på den gamla kunden.
  it('tomma ROT-uppgifter: offertens kopieras hit, med den nya sökanden', () => {
    const quoteRot = { enabled: true, applicant_name: 'Erik Johansson', personal_number: '19860801-7557', property_designation: 'Svante 1:2' };
    const update = build({ ...privateOrder, rot_details: {} }, perSeppa, 'customer', quoteRot);
    expect(update.rot_details).toEqual({ ...quoteRot, applicant_name: 'Per Seppä', personal_number: '19930512-3235' });
  });

  it('ROT avslaget: ingen sökande', () => {
    const update = build({ ...privateOrder, rot_details: { enabled: false, applicant_name: 'Erik Johansson', personal_number: '19860801-7557' } });
    expect(update.rot_details).toMatchObject({ applicant_name: null, personal_number: null });
  });

  it('inga ROT-uppgifter alls: orörda', () => {
    expect(build({ ...privateOrder, rot_details: {} }).rot_details).toEqual({});
  });

  it('prospect_id som pekar på den gamla kunden släpps', () => {
    expect(build({ ...privateOrder, prospect_id: 'cust-old' }).prospect_id).toBeNull();
    expect(build({ ...privateOrder, prospect_id: 'prospect-9' })).not.toHaveProperty('prospect_id');
  });
});

describe('customerSwapReadinessBlockers', () => {
  const blockersFor = (card: SwapCustomerCard, workAddress: 'keep' | 'customer' = 'customer', order = privateOrder) => {
    const update = buildWorkOrderCustomerSwapUpdate(order, card, { workAddress, fallbackRot: null, fortnoxCustomerNumber: '4' });
    return customerSwapReadinessBlockers(order, card, update, workAddress).map((b) => b.field);
  };

  it('ett komplett kort: inga', () => {
    expect(blockersFor(perSeppa)).toEqual([]);
  });

  // Tio siffror dödar ROT tyst i Fortnox, och skattereduktionen hade fått den gamla sökanden kvar.
  it('privatkund utan giltigt personnummer', () => {
    expect(blockersFor({ ...perSeppa, personal_number: null })).toContain('personal_number');
    expect(blockersFor({ ...perSeppa, personal_number: '930512-3235' })).toContain('personal_number');
  });

  it('företag utan org.nr', () => {
    const business = { ...privateOrder, quote_type: 'business' as const, rot_details: {} };
    const card = { ...perSeppa, customer_type: 'business' as const, company_name: 'Bygg AB', organization_number: null, personal_number: null };
    expect(blockersFor(card, 'keep', business)).toContain('organization_number');
  });

  it('inget telefonnummer att nå kunden på', () => {
    expect(blockersFor({ ...perSeppa, phone: null, mobile: null })).toContain('contact_phone');
  });

  it('den nya kundens adress väljs men är ofullständig', () => {
    const card = { ...perSeppa, visit_address: { street: 'Testvägen 1', postal_code: null, city: null } };
    expect(blockersFor(card, 'customer')).toContain('work_address');
    expect(blockersFor(card, 'keep')).not.toContain('work_address');
  });

  // Fynd som fanns före bytet är inte bytets sak.
  it('ROT-fastigheten och annat som inte rör kunden spärrar inte', () => {
    const order = { ...privateOrder, rot_details: { ...privateOrder.rot_details, property_designation: null } };
    expect(blockersFor(perSeppa, 'customer', order)).toEqual([]);
  });
});

describe('delade regler för servern och dialogen', () => {
  it('customerSwapInvoicingStarted: delfakturering, rundor eller helfakturerad', () => {
    expect(customerSwapInvoicingStarted({ status: 'scheduled' }, 0)).toBe(false);
    expect(customerSwapInvoicingStarted({ status: 'partially_invoiced' }, 0)).toBe(true);
    expect(customerSwapInvoicingStarted({ status: 'in_progress', partial_invoicing_started_at: '2026-10-01' }, 0)).toBe(true);
    expect(customerSwapInvoicingStarted({ status: 'in_progress' }, 1)).toBe(true);
    expect(customerSwapInvoicingStarted({ status: 'invoiced' }, 0)).toBe(true);
    expect(customerSwapInvoicingStarted({ status: 'completed', fortnox_invoice_number: '48' }, 0)).toBe(true);
  });

  it('orderReverseVat: snapshotens flagga först, annars kortets', () => {
    expect(orderReverseVat(true, false)).toBe(true);
    expect(orderReverseVat(false, true)).toBe(false);
    expect(orderReverseVat(null, true)).toBe(true);
    expect(orderReverseVat(undefined, null)).toBe(false);
  });

  // Ett privatkort med momsflaggan satt hade annars gjort ROT-ordern till omvänd moms (och slagit av ROT).
  it('momsflaggan skrivs bara för företag', () => {
    const update = buildWorkOrderCustomerSwapUpdate(privateOrder, { ...perSeppa, reverse_vat: true }, { workAddress: 'customer', fallbackRot: null, fortnoxCustomerNumber: '4' });
    expect((update.customer_snapshot as Record<string, unknown>).reverse_vat).toBe(false);
  });
});
