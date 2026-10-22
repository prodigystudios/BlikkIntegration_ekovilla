import { describe, it, expect } from 'vitest';
import {
  addressLines,
  customerCardUrl,
  buildCustomerCallPayload,
  isTaskOverdue,
  sortCallsNewestFirst,
  splitTasks,
  contactInitials,
  deliveryAddressDisplay,
  filterQuotes,
  filterWorkOrders,
  invoiceAddressDisplay,
  quotePlace,
  quoteSums,
  resolveCustomerTab,
  tabCountLabel,
  workOrderPlace,
  type RelatedQuote,
  type RelatedWorkOrder,
} from '@/app/crm/kunder/customerCard';

const visit = { street: 'Industrivägen 12', postal_code: '903 61', city: 'Umeå' };

describe('contactInitials', () => {
  it('de två första orden', () => {
    expect(contactInitials('Lars Nordin')).toBe('LN');
    expect(contactInitials('Anna-Karin von Platen')).toBe('AV');
  });

  it('svenska tecken', () => {
    expect(contactInitials('Örjan Åberg')).toBe('ÖÅ');
  });

  it('tomt namn ger ett frågetecken, aldrig en tom avatar', () => {
    expect(contactInitials('  ')).toBe('?');
  });
});

describe('addressLines', () => {
  it('gata på första raden, postnr och ort på andra', () => {
    expect(addressLines(visit)).toEqual(['Industrivägen 12', '903 61 Umeå']);
    expect(addressLines({ street: null, postal_code: null, city: 'Umeå' })).toEqual(['Umeå']);
    expect(addressLines(null)).toEqual([]);
  });
});

describe('deliveryAddressDisplay', () => {
  it('tom leveransadress = samma som besöksadressen', () => {
    expect(deliveryAddressDisplay({ visit_address: visit, delivery_address: null })).toEqual({ kind: 'same-as-visit' });
  });

  it('säger aldrig "samma" när det inte finns någon besöksadress', () => {
    expect(deliveryAddressDisplay({ visit_address: null, delivery_address: null })).toEqual({ kind: 'empty' });
  });

  it('en egen leveransadress visas', () => {
    const delivery = { street: 'Byggvägen 1', postal_code: '90330', city: 'Umeå' };
    expect(deliveryAddressDisplay({ visit_address: visit, delivery_address: delivery }))
      .toEqual({ kind: 'address', lines: ['Byggvägen 1', '90330 Umeå'] });
  });
});

describe('invoiceAddressDisplay', () => {
  it('lika värden (också med annan formatering av postnumret) = samma', () => {
    const invoice = { street: ' industrivägen  12', postal_code: '90361', city: 'UMEÅ' };
    expect(invoiceAddressDisplay({ visit_address: visit, invoice_address: invoice })).toEqual({ kind: 'same-as-visit' });
  });

  it('en TOM fakturaadress är okänd, inte "samma"', () => {
    expect(invoiceAddressDisplay({ visit_address: visit, invoice_address: null })).toEqual({ kind: 'empty' });
    expect(invoiceAddressDisplay({ visit_address: visit, invoice_address: { street: '', postal_code: null, city: '  ' } }))
      .toEqual({ kind: 'empty' });
  });

  it('en annan fakturaadress visas', () => {
    const invoice = { street: 'Box 12', postal_code: '90101', city: 'Umeå' };
    expect(invoiceAddressDisplay({ visit_address: visit, invoice_address: invoice }))
      .toEqual({ kind: 'address', lines: ['Box 12', '90101 Umeå'] });
  });
});

describe('resolveCustomerTab', () => {
  it('känd flik', () => {
    expect(resolveCustomerTab('offerter')).toBe('offerter');
  });

  it('okänt eller saknat värde = Översikt', () => {
    expect(resolveCustomerTab('nope')).toBe('oversikt');
    expect(resolveCustomerTab(null)).toBe('oversikt');
  });
});

describe('tabCountLabel', () => {
  it('serverns räkning vinner', () => {
    expect(tabCountLabel(100, Infinity, 143)).toBe('143');
  });

  it('når listan taket står det "+"', () => {
    expect(tabCountLabel(200, 200)).toBe('200+');
    expect(tabCountLabel(37, 200)).toBe('37');
  });
});

function quote(overrides: Partial<RelatedQuote> = {}): RelatedQuote {
  return {
    id: 'q1', quote_number: 'OFF-1', fortnox_offer_number: null, project_name: 'Vindsisolering',
    amount: 1250, currency_code: 'SEK', vat_percent: 25, pricing_summary: { subtotal: 1000, vat: 250, total: 1250 },
    status: 'sent', quote_date: '2026-10-01', assigned_to: null,
    customer_snapshot: { street_address: 'Industrivägen 12', city: 'Umeå' },
    ...overrides,
  };
}

function order(overrides: Partial<RelatedWorkOrder> = {}): RelatedWorkOrder {
  return {
    id: 'w1', order_number: 'AO-1', fortnox_order_number: null, project_name: 'Lösull hus A',
    status: 'scheduled', desired_installation_date: null, planned_start_day: null, planned_end_day: null,
    work_address: { street_address: 'Tallvägen 3', city: 'Holmsund' }, quote_id: null, assigned_to: null, assignee: null,
    ...overrides,
  };
}

describe('quotePlace', () => {
  it('arbetsadressen när offerten har en egen', () => {
    expect(quotePlace(quote({ customer_snapshot: { street_address: 'Kontoret 1', city: 'Umeå', delivery_address: 'Bygget 9', delivery_city: 'Holmsund' } })))
      .toBe('Bygget 9, Holmsund');
  });

  it('annars kundens adress, och null utan någon', () => {
    expect(quotePlace(quote())).toBe('Industrivägen 12, Umeå');
    expect(quotePlace(quote({ customer_snapshot: null }))).toBeNull();
  });
});

describe('workOrderPlace', () => {
  it('gata och ort, eller null', () => {
    expect(workOrderPlace(order())).toBe('Tallvägen 3, Holmsund');
    expect(workOrderPlace(order({ work_address: {} }))).toBeNull();
  });
});

describe('filterQuotes', () => {
  const list = [
    quote({ id: 'a', status: 'draft', project_name: 'Takisolering' }),
    quote({ id: 'b', status: 'won', quote_number: 'OFF-77' }),
    quote({ id: 'c', status: 'follow_up' }),
  ];

  it('filtrerar på status', () => {
    expect(filterQuotes(list, '', 'vunna').map((q) => q.id)).toEqual(['b']);
    expect(filterQuotes(list, '', 'folj-upp').map((q) => q.id)).toEqual(['c']);
    expect(filterQuotes(list, '', 'alla')).toHaveLength(3);
  });

  it('söker på nummer, benämning och plats, oberoende av skiftläge', () => {
    expect(filterQuotes(list, 'off-77', 'alla').map((q) => q.id)).toEqual(['b']);
    expect(filterQuotes(list, 'TAK', 'alla').map((q) => q.id)).toEqual(['a']);
    expect(filterQuotes(list, 'umeå', 'utkast').map((q) => q.id)).toEqual(['a']);
  });
});

describe('filterWorkOrders', () => {
  it('söker på nummer, benämning och adress', () => {
    const list = [order({ id: 'a' }), order({ id: 'b', fortnox_order_number: '5531', work_address: { city: 'Umeå' } })];
    expect(filterWorkOrders(list, 'holmsund').map((w) => w.id)).toEqual(['a']);
    expect(filterWorkOrders(list, '5531').map((w) => w.id)).toEqual(['b']);
    expect(filterWorkOrders(list, '  ')).toHaveLength(2);
  });
});

describe('quoteSums', () => {
  it('räknar netto, inte brutto — byggmoms och privatkund i samma summa', () => {
    const sums = quoteSums([
      quote({ status: 'won' }), // 1 250 brutto, 25 % → 1 000 netto
      quote({ status: 'won', amount: 2000, vat_percent: 0, pricing_summary: { subtotal: 2000, vat: 0, total: 2000 } }),
      quote({ status: 'sent' }),
      quote({ status: 'lost' }),
    ]);
    expect(sums).toEqual({ won: 3000, open: 1000, otherCurrency: false });
  });

  it('lägger aldrig ihop euro med kronor', () => {
    const sums = quoteSums([quote({ status: 'won' }), quote({ status: 'won', currency_code: 'EUR' })]);
    expect(sums).toEqual({ won: 1000, open: 0, otherCurrency: true });
  });

  it('en tom pricing_summary ger inte en tyst nolla', () => {
    const sums = quoteSums([quote({ status: 'draft', pricing_summary: { subtotal: 0, vat: 0, total: 0 } })]);
    expect(sums.open).toBeCloseTo(1000);
  });
});

const callDraft = { outcome: 'positive' as const, summary: '  Bra samtal  ', next_step: '', call_at: '' };

describe('buildCustomerCallPayload', () => {
  it('samma form som samtalssidan med vald kund: bara kopplingen och samtalet', () => {
    const payload = buildCustomerCallPayload('c1', callDraft);
    expect(payload).toEqual({ customer_id: 'c1', outcome: 'positive', summary: 'Bra samtal', next_step: null });
  });

  it('aldrig prospect_id, och ingen kopierad kontaktdata', () => {
    const payload = buildCustomerCallPayload('c1', callDraft);
    for (const key of ['prospect_id', 'company_name', 'email', 'phone', 'call_at']) expect(payload).not.toHaveProperty(key);
  });

  it('tidpunkten följer med när den är ifylld', () => {
    expect(buildCustomerCallPayload('c1', { ...callDraft, call_at: '2026-10-20T14:30' })).toHaveProperty('call_at');
  });
});

function task(overrides: Partial<RelatedTaskLike> = {}): RelatedTaskLike {
  return { id: 't', status: 'open', due_date: null, ...overrides };
}
type RelatedTaskLike = { id: string; status: 'open' | 'done' | 'cancelled'; due_date: string | null };

describe('splitTasks', () => {
  it('avbrutna hör till Klara, inte Att göra', () => {
    const { open, closed } = splitTasks([task({ id: 'a' }), task({ id: 'b', status: 'done' }), task({ id: 'c', status: 'cancelled' })] as never);
    expect(open.map((t) => t.id)).toEqual(['a']);
    expect(closed.map((t) => t.id)).toEqual(['b', 'c']);
  });
});

describe('isTaskOverdue', () => {
  it('bara öppna uppgifter med passerad dag', () => {
    expect(isTaskOverdue({ status: 'open', due_date: '2026-10-21' }, '2026-10-22')).toBe(true);
    expect(isTaskOverdue({ status: 'open', due_date: '2026-10-22' }, '2026-10-22')).toBe(false);
    expect(isTaskOverdue({ status: 'done', due_date: '2026-10-01' }, '2026-10-22')).toBe(false);
    expect(isTaskOverdue({ status: 'open', due_date: null }, '2026-10-22')).toBe(false);
  });
});

describe('sortCallsNewestFirst', () => {
  it('ett bakåtdaterat samtal hamnar på sin plats', () => {
    const calls = [
      { id: 'ny', call_at: '2026-10-20T10:00:00Z' },
      { id: 'gammal', call_at: '2026-10-01T10:00:00Z' },
      { id: 'mitten', call_at: '2026-10-10T10:00:00Z' },
    ];
    expect(sortCallsNewestFirst(calls as never).map((c: { id: string }) => c.id)).toEqual(['ny', 'mitten', 'gammal']);
  });
});

describe('customerCardUrl', () => {
  it('Översikt utan parametrar, annars fliken', () => {
    expect(customerCardUrl('c1', 'oversikt', null)).toBe('/crm/kunder/c1');
    expect(customerCardUrl('c1', 'arbetsorder', null)).toBe('/crm/kunder/c1?tab=arbetsorder');
  });

  it('kortets egen returväg följer med, kodad', () => {
    expect(customerCardUrl('c1', 'offerter', '/crm/offerter?quote_id=q1'))
      .toBe('/crm/kunder/c1?tab=offerter&returnTo=%2Fcrm%2Fofferter%3Fquote_id%3Dq1');
  });

  it('men utan SIN returväg — kedjan blir högst en nivå', () => {
    expect(customerCardUrl('c1', 'oversikt', '/crm/offerter?quote_id=q1&returnTo=%2Fcrm%2Fkunder%2Fc1'))
      .toBe('/crm/kunder/c1?returnTo=%2Fcrm%2Fofferter%3Fquote_id%3Dq1');
  });
});
