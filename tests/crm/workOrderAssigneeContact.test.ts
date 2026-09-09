import { describe, it, expect, vi } from 'vitest';

// Modulen importerar getSupabaseAdmin på toppnivå (återlänkningen i createCrmWorkOrderFromQuote
// kör med elevated klient). Den rörs inte här, men den måste finnas för att importen ska gå igenom.
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => null }));

import { getWorkOrderAssigneeContact, normalizeAssigneeContact } from '@/lib/domains/crm/work-orders';

// Den ansvarige på arbetsordern, som fältvyn visar hen: namn + nummer, ingenting annat.
//
// 🧨 Regressionsvakten som gör hela funktionen nödvändig ligger i det sista testet: profilen läses
// SEPARAT, med admin-klienten, i stället för genom `assignee:profiles!assigned_to`-embeden på
// arbetsordern. Den embeden ger null för alla utom en själv (profiles_select_self), tyst och utan
// fel — alltså "ingen ansvarig" i stället för "du fick inte se". Går någon tillbaka till joinen
// försvinner kortet ur fältvyn utan att ett enda test blir rött, om det inte står här.

function makeSupabase(
  assignedTo: string | null,
  profile: Record<string, unknown> | null = null,
  errors: { workOrder?: { message: string }; profile?: { message: string } } = {},
) {
  const tablesRead: string[] = [];
  const columnsRead: Record<string, string> = {};
  const supabase = {
    from(table: string) {
      tablesRead.push(table);
      const builder: any = {
        select: vi.fn((cols: string) => { columnsRead[table] = cols; return builder; }),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(() => {
          if (table === 'crm_work_orders') {
            return Promise.resolve(
              errors.workOrder
                ? { data: null, error: errors.workOrder }
                : { data: { assigned_to: assignedTo }, error: null },
            );
          }
          if (table === 'profiles') {
            return Promise.resolve(
              errors.profile ? { data: null, error: errors.profile } : { data: profile, error: null },
            );
          }
          return Promise.resolve({ data: null, error: { message: `oväntat anrop: ${table}` } });
        }),
      };
      return builder;
    },
  } as any;
  return { supabase, tablesRead, columnsRead };
}

describe('normalizeAssigneeContact', () => {
  it('namn och nummer följer med', () => {
    expect(normalizeAssigneeContact({ full_name: 'Anders Säljare', phone: '070-123 45 67' }))
      .toEqual({ name: 'Anders Säljare', phone: '070-123 45 67' });
  });

  // ⚠️ En profil med bara ett nummer ska ändå visas — numret är det besättningen behöver, och
  // "Namn saknas" i kortet är sannare än inget kort alls.
  it('bara nummer räcker för att visa kortet', () => {
    expect(normalizeAssigneeContact({ full_name: null, phone: '070-1' })).toEqual({ name: null, phone: '070-1' });
  });

  it('bara namn räcker också — då står kortet utan ringrad', () => {
    expect(normalizeAssigneeContact({ full_name: 'Anders', phone: null })).toEqual({ name: 'Anders', phone: null });
  });

  // 🧨 Blanktecken är inte ett värde. Utan trimningen renderade kortet rubriken "Ansvarig säljare"
  // över en tom rad, och ett mellanslag i telefonfältet hade gett en tel:-länk till ingenting.
  it('blanka fält räknas som tomma', () => {
    expect(normalizeAssigneeContact({ full_name: '  ', phone: '\t' })).toBeNull();
    expect(normalizeAssigneeContact({ full_name: '  Anders  ', phone: '  ' })).toEqual({ name: 'Anders', phone: null });
  });

  it('tom profil ger inget kort', () => {
    expect(normalizeAssigneeContact({})).toBeNull();
    expect(normalizeAssigneeContact(null)).toBeNull();
    expect(normalizeAssigneeContact(undefined)).toBeNull();
  });
});

describe('getWorkOrderAssigneeContact', () => {
  it('slår upp den ansvariges namn och nummer', async () => {
    const { supabase } = makeSupabase('user-1', { full_name: 'Anders Säljare', phone: '070-123 45 67' });
    const { data, error } = await getWorkOrderAssigneeContact(supabase, 'wo1');
    expect(error).toBeNull();
    expect(data).toEqual({ name: 'Anders Säljare', phone: '070-123 45 67' });
  });

  // En otilldelad order (standalone-ordrar sätter assigned_to, men fältet är nullable) ska inte
  // kosta en profilläsning som ändå inte kan svara.
  it('otilldelad order svarar null utan att röra profiles', async () => {
    const { supabase, tablesRead } = makeSupabase(null);
    const { data, error } = await getWorkOrderAssigneeContact(supabase, 'wo1');
    expect(data).toBeNull();
    expect(error).toBeNull();
    expect(tablesRead).not.toContain('profiles');
  });

  // Den ansvarige kan ha slutat: raden är kvar på ordern, profilen är borta.
  it('en ansvarig utan profil svarar null', async () => {
    const { supabase } = makeSupabase('user-borta', null);
    const { data, error } = await getWorkOrderAssigneeContact(supabase, 'wo1');
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('läsfel bärs upp i stället för att se ut som en otilldelad order', async () => {
    const woFail = makeSupabase('user-1', null, { workOrder: { message: 'tillfälligt fel' } });
    expect((await getWorkOrderAssigneeContact(woFail.supabase, 'wo1')).error).toMatchObject({ message: 'tillfälligt fel' });

    const profileFail = makeSupabase('user-1', null, { profile: { message: 'tillfälligt fel' } });
    expect((await getWorkOrderAssigneeContact(profileFail.supabase, 'wo1')).error).toMatchObject({ message: 'tillfälligt fel' });
  });

  // 🧨 REGRESSIONSVAKT, TVÅ SKÄL.
  //
  // (1) Profilen måste läsas som en EGEN fråga mot `profiles`. Den uppenbara "förenklingen" är att
  //     låta `assignee:profiles!assigned_to`-embeden på arbetsordern bära namnet — den finns redan
  //     i crmWorkOrderSelect. Men fältvyns anrop går via sessionsklienten, och profiles har en enda
  //     SELECT-policy (`auth.uid() = id`), så embeden ger null för varje ANNAN person. Tyst.
  //
  // (2) Selecten måste räkna upp sina kolumner. `profiles` bär private_email, hemadress och
  //     anhörigkontakt; ett `select('*')` hade skickat dem till en telefon i fält, eftersom RLS är
  //     radnivå och inte kan smalna av kolumner. Samma familj som redactWorkOrderForField.
  it('läser profiles separat, och bara de två kolumnerna', async () => {
    const { supabase, tablesRead, columnsRead } = makeSupabase('user-1', { full_name: 'Anders', phone: '070-1' });
    await getWorkOrderAssigneeContact(supabase, 'wo1');

    expect(tablesRead).toEqual(['crm_work_orders', 'profiles']);
    expect(columnsRead.profiles).toBe('full_name, phone');
    expect(columnsRead.profiles).not.toContain('*');
    for (const forbidden of ['private_email', 'address_line1', 'postal_code', 'city', 'emergency_contact', 'clothing_size']) {
      expect(columnsRead.profiles).not.toContain(forbidden);
    }
  });
});
