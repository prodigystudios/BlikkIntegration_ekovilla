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

// TVÅ klienter, som i routen: sessionsklienten läser arbetsordern (RLS avgör om läsaren hör till
// jobbet), admin-klienten bara profilraden. De hålls isär här av samma skäl som i koden — testet
// ska kunna säga VILKEN klient som rörde vilken tabell.
//
// `assignedTo: null` står för båda utfallen sessionsklienten kan ge utan fel: en otilldelad order
// OCH en order RLS gömmer (noll rader → `data: null`). Kortet ska utebli i båda fallen.
function makeClients(
  assignedTo: string | null,
  profile: Record<string, unknown> | null = null,
  errors: { workOrder?: { message: string }; profile?: { message: string } } = {},
) {
  const sessionTables: string[] = [];
  const adminTables: string[] = [];
  const columnsRead: Record<string, string> = {};

  function client(tables: string[], allowed: string) {
    return {
      from(table: string) {
        tables.push(table);
        const builder: any = {
          select: vi.fn((cols: string) => { columnsRead[table] = cols; return builder; }),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(() => {
            if (table !== allowed) {
              return Promise.resolve({ data: null, error: { message: `fel klient läste ${table}` } });
            }
            if (table === 'crm_work_orders') {
              return Promise.resolve(
                errors.workOrder
                  ? { data: null, error: errors.workOrder }
                  : { data: assignedTo === null ? null : { assigned_to: assignedTo }, error: null },
              );
            }
            return Promise.resolve(
              errors.profile ? { data: null, error: errors.profile } : { data: profile, error: null },
            );
          }),
        };
        return builder;
      },
    } as any;
  }

  return {
    supabase: client(sessionTables, 'crm_work_orders'),
    admin: client(adminTables, 'profiles'),
    sessionTables,
    adminTables,
    columnsRead,
  };
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
    const { supabase, admin } = makeClients('user-1', { full_name: 'Anders Säljare', phone: '070-123 45 67' });
    const { data, error } = await getWorkOrderAssigneeContact(supabase, admin, 'wo1');
    expect(error).toBeNull();
    expect(data).toEqual({ name: 'Anders Säljare', phone: '070-123 45 67' });
  });

  // 🧨 HUVUDVAKTEN — RLS ÄR GRINDEN, OCH DEN SITTER FÖRE ELEVERINGEN.
  //
  // Sessionsklientens noll rader (en order läsaren inte hör till) måste avbryta HELA uppslaget.
  // Görs båda läsningarna eleverade — den formen fanns i första utkastet — svarar routen med
  // säljarens namn och privata mobil för vilket order-UUID som helst, åt vilket inloggat konto som
  // helst. Och "inloggad" är inte "anställd": /auth/create-account delar ut role='member' fritt.
  //
  // Att profiles ALDRIG rördes är hela assertionen. Ett test som bara kollar `data === null` hade
  // varit grönt även om profilen hämtades och sedan kastades bort.
  it('en order läsaren inte får se stoppar uppslaget före profilen', async () => {
    const { supabase, admin, adminTables } = makeClients(null, { full_name: 'Anders', phone: '070-1' });
    const { data, error } = await getWorkOrderAssigneeContact(supabase, admin, 'wo1');
    expect(data).toBeNull();
    expect(error).toBeNull();
    expect(adminTables).toEqual([]);
  });

  // Samma svar, andra orsaken: ordern syns men har ingen ansvarig (fältet är nullable).
  it('otilldelad order svarar null utan att röra profiles', async () => {
    const { supabase, admin, adminTables } = makeClients(null);
    const { data } = await getWorkOrderAssigneeContact(supabase, admin, 'wo1');
    expect(data).toBeNull();
    expect(adminTables).not.toContain('profiles');
  });

  // Den ansvarige kan ha slutat: raden är kvar på ordern, profilen är borta.
  it('en ansvarig utan profil svarar null', async () => {
    const { supabase, admin } = makeClients('user-borta', null);
    const { data, error } = await getWorkOrderAssigneeContact(supabase, admin, 'wo1');
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('läsfel bärs upp i stället för att se ut som en otilldelad order', async () => {
    const woFail = makeClients('user-1', null, { workOrder: { message: 'tillfälligt fel' } });
    expect((await getWorkOrderAssigneeContact(woFail.supabase, woFail.admin, 'wo1')).error)
      .toMatchObject({ message: 'tillfälligt fel' });

    const profileFail = makeClients('user-1', null, { profile: { message: 'tillfälligt fel' } });
    expect((await getWorkOrderAssigneeContact(profileFail.supabase, profileFail.admin, 'wo1')).error)
      .toMatchObject({ message: 'tillfälligt fel' });
  });

  // 🧨 REGRESSIONSVAKT, TRE SKÄL.
  //
  // (1) Arbetsordern måste läsas med SESSIONSKLIENTEN, profilen med admin — aldrig tvärtom och
  //     aldrig båda med samma. Se vakten ovan för vad den blandningen kostar.
  //
  // (2) Profilen måste läsas som en EGEN fråga mot `profiles`. Den uppenbara "förenklingen" är att
  //     låta `assignee:profiles!assigned_to`-embeden på arbetsordern bära namnet — den finns redan
  //     i crmWorkOrderSelect. Men det anropet går via sessionsklienten, och profiles har en enda
  //     SELECT-policy (`auth.uid() = id`), så embeden ger null för varje ANNAN person. Tyst.
  //
  // (3) Selecten måste räkna upp sina kolumner. `profiles` bär private_email, hemadress och
  //     anhörigkontakt; ett `select('*')` hade skickat dem till en telefon i fält, eftersom RLS är
  //     radnivå och inte kan smalna av kolumner. Samma familj som redactWorkOrderForField.
  it('rätt klient på rätt tabell, och bara de två kolumnerna', async () => {
    const { supabase, admin, sessionTables, adminTables, columnsRead } =
      makeClients('user-1', { full_name: 'Anders', phone: '070-1' });
    await getWorkOrderAssigneeContact(supabase, admin, 'wo1');

    expect(sessionTables).toEqual(['crm_work_orders']);
    expect(adminTables).toEqual(['profiles']);
    expect(columnsRead.profiles).toBe('full_name, phone');
    expect(columnsRead.profiles).not.toContain('*');
    for (const forbidden of ['private_email', 'address_line1', 'postal_code', 'city', 'emergency_contact', 'clothing_size']) {
      expect(columnsRead.profiles).not.toContain(forbidden);
    }
  });
});
