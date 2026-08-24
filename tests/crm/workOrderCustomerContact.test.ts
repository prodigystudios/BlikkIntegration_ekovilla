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
  it('slutkunden på plats vinner och ärver ingen adress', async () => {
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
      // Kundens egen adress följer med för utskick — men den visas aldrig som slutkundens.
      customerEmail: 'robert@acme.se',
      isOnSiteContact: true,
    });
  });

  // ⚠️ Fångat i granskningen: en slutkund fångas ofta med BARA namn, och en helt-eller-inget-
  // hämtning lämnade då besättningen utan nummer att ringa när de stod på plats.
  it('slutkund utan eget nummer lånar ändå ett — någon måste gå att nå på plats', async () => {
    const { data } = await getWorkOrderCustomerContact(
      makeSupabase({ end_contact_name: 'Fastighetsskötaren', contact_name: 'Anna', phone: '08-111', email: 'anna@acme.se' }, ACME),
      'wo1',
    );
    expect(data).toMatchObject({ contactName: 'Fastighetsskötaren', phone: '08-111', email: null });
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

  // ⚠️ Fångat i granskningen: byggdes orderns kontakt på namn ELLER telefon fick en snapshot med
  // bara ett nummer tränga undan kortets primärkontakt — fältvyn visade ett naket nummer utan namn.
  it('snapshot med bara ett nummer är ingen vald person — kortet gäller', async () => {
    const { data } = await getWorkOrderCustomerContact(
      makeSupabase({ contact_name: null, phone: '08-999', email: null }, ACME),
      'wo1',
    );
    expect(data).toMatchObject({ contactName: 'Anna', phone: '08-111', email: 'anna@acme.se' });
  });

  // ⚠️ Fångat i granskningen: skrivvägen slog upp namnet på kortet, fältvyn gjorde det inte — så
  // samma order kunde svara med Björns adress på ena hållet och ingen alls på det andra.
  it('en äldre order med bara ett namn slår upp personen på kortet', async () => {
    const { data } = await getWorkOrderCustomerContact(
      makeSupabase({ contact_name: 'Björn', phone: null, email: null }, {
        ...ACME,
        contacts: [
          { name: 'Anna', email: 'anna@acme.se', phone: '08-111', is_primary: true },
          { name: 'Björn', email: 'bjorn@acme.se', phone: '08-222' },
        ],
      }),
      'wo1',
    );
    expect(data).toMatchObject({ contactName: 'Björn', phone: '08-222', email: 'bjorn@acme.se' });
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

  // ⚠️ Fångat i granskningen: `email` är kontaktpersonens EGNA adress och blir null när hen inte
  // har någon. Planeringens bekräftelsemodal prefillade sin MOTTAGARE ur den — fältet blev tomt
  // och "skicka mejl" avbockat. Kundens egen adress följer därför med separat: den tillskrivs
  // ingen och duger för ett utskick.
  it('kundens egen adress följer med för utskick, även när kontakten saknar egen', async () => {
    const { data } = await getWorkOrderCustomerContact(
      makeSupabase({ contact_name: 'Jonas' }, ACME),
      'wo1',
    );
    expect(data).toMatchObject({ contactName: 'Jonas', email: null, customerEmail: 'robert@acme.se' });
  });

  it('namnet matchas skiftlägesokänsligt — annars tömdes adressen på en bomma', async () => {
    const { data } = await getWorkOrderCustomerContact(
      makeSupabase({ contact_name: 'anna' }, ACME),
      'wo1',
    );
    expect(data).toMatchObject({ contactName: 'anna', email: 'anna@acme.se' });
  });

  it('varken kundkoppling, kontakt eller kortadress → inget att visa', async () => {
    const { data } = await getWorkOrderCustomerContact(makeSupabase({}, null, null), 'wo1');
    expect(data).toBeNull();
  });
});
