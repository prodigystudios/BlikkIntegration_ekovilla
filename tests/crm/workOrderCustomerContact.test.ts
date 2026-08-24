import { describe, it, expect, vi } from 'vitest';

// Modulen importerar getSupabaseAdmin på toppnivå (återlänkningen i createCrmWorkOrderFromQuote
// kör med elevated klient). Den rörs inte här, men den måste finnas för att importen ska gå igenom.
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => null }));

import { getWorkOrderCustomerContact } from '@/lib/domains/crm/work-orders';

// Kontaktuppgifterna fältvyn visar. Uppslaget är EN källa i taget, aldrig fält för fält mellan
// två personer:
//
//   1. slutkunden på plats (end_contact_*) — lånar ingenting
//   2. orderns egen kontakt (snapshoten) — den CRM-vyn redigerar
//   3. kundkortet — sista utvägen för äldre ordrar som aldrig fångade någon kontakt
//
// Ordningen är hela poängen: steg 2 saknades, så ett kontaktbyte gjort i CRM nådde aldrig
// installatörerna det gjordes för — fältvyn visade kundkortets kontakt i stället.

function makeSupabase(
  customerSnapshot: Record<string, unknown> | null,
  customer: Record<string, unknown> | null = null,
  customerId: string | null = 'cust-1',
) {
  return {
    from(table: string) {
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(() => {
          if (table === 'crm_work_orders') {
            return Promise.resolve({ data: { customer_id: customerId, customer_snapshot: customerSnapshot }, error: null });
          }
          if (table === 'crm_customers') return Promise.resolve({ data: customer, error: null });
          return Promise.resolve({ data: null, error: { message: `oväntat anrop: ${table}` } });
        }),
      };
      return builder;
    },
  } as any;
}

const ACME = {
  customer_type: 'business',
  email: 'robert@acme.se',
  phone: '08-000',
  mobile: null,
  contacts: [{ name: 'Anna', email: 'anna@acme.se', phone: '08-111', is_primary: true }],
};

describe('getWorkOrderCustomerContact', () => {
  it('slutkunden på plats vinner och lånar ingenting', async () => {
    const { data } = await getWorkOrderCustomerContact(
      makeSupabase({ end_contact_name: 'Fastighetsskötaren', end_contact_phone: '070-9', contact_name: 'Anna', email: 'anna@acme.se' }, ACME),
      'wo1',
    );
    expect(data).toEqual({
      contactName: 'Fastighetsskötaren',
      phone: '070-9',
      // ⚠️ Inte anna@acme.se. Slutkunden är en annan person — en adress lånad hit hade stått
      // under fel namn. Blandningen låg i klienten och är borta.
      email: null,
      isOnSiteContact: true,
    });
  });

  // ⚠️ REGRESSION: den här saknades helt. Fältvyn gick direkt på kundkortet, så en säljare som
  // bytte kontaktperson på ordern i CRM såg bytet — installatörerna gjorde det inte.
  it('orderns egen kontakt går före kundkortets primärkontakt', async () => {
    const { data } = await getWorkOrderCustomerContact(
      makeSupabase({ contact_name: 'Björn', phone: '08-222', email: 'bjorn@acme.se' }, ACME),
      'wo1',
    );
    expect(data).toMatchObject({ contactName: 'Björn', phone: '08-222', email: 'bjorn@acme.se', isOnSiteContact: false });
  });

  it('företagskontakt på ordern utan egen adress ärver inte bolagets', async () => {
    const { data } = await getWorkOrderCustomerContact(
      makeSupabase({ contact_name: 'Jonas', phone: null, email: null }, ACME),
      'wo1',
    );
    // Numret lånas — växeln kopplar. Adressen gör det inte: den är Roberts, inte Jonas.
    expect(data).toMatchObject({ contactName: 'Jonas', phone: '08-000', email: null });
  });

  it('privatkundens order ärver kortets adress — kontaktraden ÄR kunden', async () => {
    const { data } = await getWorkOrderCustomerContact(
      makeSupabase({ contact_name: 'Anna Andersson', phone: null, email: null }, {
        customer_type: 'private',
        email: 'anna@example.se',
        phone: '070-1',
        mobile: null,
        contacts: [{ name: 'Anna Andersson', email: null, phone: null, is_primary: true }],
      }),
      'wo1',
    );
    expect(data).toMatchObject({ contactName: 'Anna Andersson', phone: '070-1', email: 'anna@example.se' });
  });

  it('tom snapshot (äldre order) faller tillbaka på kortets primärkontakt', async () => {
    const { data } = await getWorkOrderCustomerContact(makeSupabase({}, ACME), 'wo1');
    expect(data).toMatchObject({ contactName: 'Anna', phone: '08-111', email: 'anna@acme.se' });
  });

  it('fristående order utan kundkoppling använder sin egen kontakt', async () => {
    const { data } = await getWorkOrderCustomerContact(
      makeSupabase({ contact_name: 'Björn', phone: '08-222', email: null }, null, null),
      'wo1',
    );
    expect(data).toMatchObject({ contactName: 'Björn', phone: '08-222', email: null });
  });

  it('varken kundkoppling eller kontakt → inget att visa', async () => {
    const { data } = await getWorkOrderCustomerContact(makeSupabase({}, null, null), 'wo1');
    expect(data).toBeNull();
  });
});
