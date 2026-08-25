import { describe, it, expect } from 'vitest';
import {
  contactRowByName,
  primaryCrmContact,
  resolveCrmContact,
  crmContactRecipients,
  documentRecipients,
  type CrmContactSource,
} from '@/lib/domains/crm/contacts';

// The bug this module exists to prevent: a customer's e-mail lives on the card OR on a
// contact row depending on which flow created it, and every read site used to guess its own
// precedence. These tests lock the one rule down.

describe('primaryCrmContact', () => {
  it('primärflaggan vinner över ordningen', () => {
    const contacts = [
      { name: 'Bo', is_primary: false },
      { name: 'Anna', is_primary: true },
    ];
    expect(primaryCrmContact({ contacts })?.name).toBe('Anna');
  });

  it('utan primärflagga används första kontakten', () => {
    expect(primaryCrmContact({ contacts: [{ name: 'Bo' }, { name: 'Anna' }] })?.name).toBe('Bo');
  });

  it('inga kontakter → null', () => {
    expect(primaryCrmContact({ contacts: [] })).toBeNull();
    expect(primaryCrmContact({})).toBeNull();
  });
});

describe('resolveCrmContact', () => {
  it('namngiven kontakt vinner över kundkortet', () => {
    expect(resolveCrmContact({
      email: 'info@acme.se',
      phone: '08-000',
      contacts: [{ name: 'Anna', email: 'anna@acme.se', phone: '08-111', is_primary: true }],
    })).toEqual({ name: 'Anna', email: 'anna@acme.se', phone: '08-111' });
  });

  // Kärnan i buggen: kunder skapade via kundformuläret eller Fortnox-importen har INGA
  // kontaktrader — bara kundkortets egna fält.
  it('utan kontaktrader faller tillbaka på kundkortet', () => {
    expect(resolveCrmContact({ email: 'info@acme.se', phone: '08-000', contacts: [] }))
      .toEqual({ name: '', email: 'info@acme.se', phone: '08-000' });
  });

  // Fält för fält, inte allt-eller-inget: en kontakt utan telefon ska inte tysta kortets nummer.
  // Utan `customer_type` i selecten lånas ÄVEN e-posten ut, precis som före e-postregeln — det är
  // det medvetna bakåtkompatibla läget, inte en glömska.
  it('faller tillbaka per fält när customer_type inte valts ut (bakåtkompatibelt)', () => {
    expect(resolveCrmContact({
      email: 'info@acme.se',
      phone: '08-000',
      contacts: [{ name: 'Anna', email: null, phone: '08-111', is_primary: true }],
    })).toEqual({ name: 'Anna', email: 'info@acme.se', phone: '08-111' });
  });

  it('mobil används när telefon saknas', () => {
    expect(resolveCrmContact({ phone: '  ', mobile: '070-123' }).phone).toBe('070-123');
  });

  it('blanktecken räknas inte som värde', () => {
    expect(resolveCrmContact({ email: '  ', contacts: [{ name: '  ', email: '   ' }] }))
      .toEqual({ name: '', email: '', phone: '' });
  });

  it('helt tom kund → tomma strängar, aldrig undefined', () => {
    expect(resolveCrmContact({})).toEqual({ name: '', email: '', phone: '' });
  });

  it('preferContact går före primärkontakten', () => {
    const customer: CrmContactSource = {
      email: 'info@acme.se',
      contacts: [
        { name: 'Anna', email: 'anna@acme.se', is_primary: true },
        { name: 'Bo', email: 'bo@acme.se' },
      ],
    };
    expect(resolveCrmContact(customer, customer.contacts![1]).email).toBe('bo@acme.se');
  });

  it('preferContact utan e-post hämtar aldrig primärkontaktens adress', () => {
    const customer: CrmContactSource = {
      customer_type: 'business',
      email: 'info@acme.se',
      contacts: [
        { name: 'Anna', email: 'anna@acme.se', is_primary: true },
        { name: 'Bo', email: null },
      ],
    };
    // Varken Annas eller bolagets — Bo har ingen adress, och då har raden ingen.
    expect(resolveCrmContact(customer, customer.contacts![1])).toEqual({
      name: 'Bo', email: '', phone: '',
    });
  });
});

describe('contactRowByName', () => {
  const acme: CrmContactSource = {
    contacts: [{ name: 'Anna Andersson', email: 'anna@acme.se', is_primary: true }, { name: 'Björn', email: 'bjorn@acme.se' }],
  };

  it('slår upp den rad ett sparat namn syftar på', () => {
    expect(contactRowByName(acme, 'Björn')?.email).toBe('bjorn@acme.se');
  });

  // Namnet skrivs för hand på ett ställe och väljs ur en lista på ett annat. En bomma här tömmer
  // adressen (namn-bara-rad → inget lån), så matchningen får inte vara strängare än nödvändigt.
  it('bryr sig inte om skiftläge eller kantmellanslag', () => {
    expect(contactRowByName(acme, '  björn ')?.email).toBe('bjorn@acme.se');
  });

  it('okänt eller tomt namn → null, aldrig en gissning', () => {
    expect(contactRowByName(acme, 'Jonas')).toBeNull();
    expect(contactRowByName(acme, '   ')).toBeNull();
    expect(contactRowByName({}, 'Anna Andersson')).toBeNull();
  });
});

// ── E-posten lånas inte ut åt en namngiven person på ett företag ──────────────────────────────
//
// Rapporterat i drift: ordern visade "Jonas" som kontaktperson med Roberts e-post. Kortets adress
// tillhör KUNDEN — på ett bolag är den växeln/inkorgen, inte den anställdes. Telefonen lånas
// fortfarande ut med flit: ett nummer är en väg fram, och orderspärren kräver att det finns ett.
describe('resolveCrmContact — kortets e-post lånas inte ut till en annan person', () => {
  const acme: CrmContactSource = {
    customer_type: 'business',
    email: 'robert@acme.se',
    phone: '08-000',
    contacts: [{ name: 'Jonas', email: null, phone: null, is_primary: true }],
  };

  it('företagskontakt utan egen adress får INGEN adress', () => {
    expect(resolveCrmContact(acme).email).toBe('');
  });

  it('men numret lånas fortfarande — växeln kopplar, och orderspärren kräver ett nummer', () => {
    expect(resolveCrmContact(acme).phone).toBe('08-000');
    expect(resolveCrmContact(acme).name).toBe('Jonas');
  });

  it('har kontakten en egen adress används den, som förut', () => {
    expect(resolveCrmContact({ ...acme, contacts: [{ name: 'Jonas', email: 'jonas@acme.se' }] }).email)
      .toBe('jonas@acme.se');
  });

  it('utan kontaktrader är kortets adress fortfarande rätt — den tillskrivs ingen', () => {
    expect(resolveCrmContact({ ...acme, contacts: [] }).email).toBe('robert@acme.se');
  });

  // ⚠️ BÄRANDE: privatkunden får en automatisk kontaktrad med BARA namnet (createCrmCustomer).
  // Den raden ÄR kunden, så kortets adress är hens egen. Stramade vi åt här skulle varje
  // privatkund tappa sin e-post på offert, order och i fältvyn.
  it('privatkundens namn-bara-rad ärver kortet — den raden är kunden själv', () => {
    expect(resolveCrmContact({
      customer_type: 'private',
      email: 'anna@example.se',
      phone: '070-1',
      contacts: [{ name: 'Anna Andersson', email: null, phone: null, is_primary: true }],
    })).toEqual({ name: 'Anna Andersson', email: 'anna@example.se', phone: '070-1' });
  });
});

describe('crmContactRecipients', () => {
  it('primärkontakt först, sedan övriga, sist kundkortet', () => {
    expect(crmContactRecipients({
      email: 'info@acme.se',
      contacts: [
        { name: 'Bo', email: 'bo@acme.se' },
        { name: 'Anna', email: 'anna@acme.se', is_primary: true },
      ],
    })).toEqual([
      { email: 'anna@acme.se', label: 'Anna' },
      { email: 'bo@acme.se', label: 'Bo' },
      { email: 'info@acme.se', label: 'Kundens adress' },
    ]);
  });

  it('kontakter utan e-post hoppas över', () => {
    expect(crmContactRecipients({
      email: 'info@acme.se',
      contacts: [{ name: 'Anna', email: null, is_primary: true }],
    })).toEqual([{ email: 'info@acme.se', label: 'Kundens adress' }]);
  });

  it('dubbletter tas bort skiftlägesokänsligt — kortets adress dyker inte upp igen', () => {
    expect(crmContactRecipients({
      email: 'Anna@Acme.se',
      contacts: [{ name: 'Anna', email: 'anna@acme.se', is_primary: true }],
    })).toEqual([{ email: 'anna@acme.se', label: 'Anna' }]);
  });

  it('kund utan adresser → tom lista', () => {
    expect(crmContactRecipients({ contacts: [] })).toEqual([]);
  });
});

describe('documentRecipients', () => {
  const customer: CrmContactSource = {
    email: 'info@acme.se',
    contacts: [{ name: 'Anna', email: 'anna@acme.se', is_primary: true }],
  };

  it('snapshotadressen leder', () => {
    expect(documentRecipients('gammal@acme.se', customer, 'Från offerten')).toEqual([
      { email: 'gammal@acme.se', label: 'Från offerten' },
      { email: 'anna@acme.se', label: 'Anna' },
      { email: 'info@acme.se', label: 'Kundens adress' },
    ]);
  });

  // Annars skulle samma adress dyka upp två gånger, en gång med sämre etikett.
  it('snapshotadress som redan är känd dubbleras inte och behåller kundens etikett', () => {
    expect(documentRecipients('anna@acme.se', customer)).toEqual([
      { email: 'anna@acme.se', label: 'Anna' },
      { email: 'info@acme.se', label: 'Kundens adress' },
    ]);
  });

  it('matchar skiftlägesokänsligt', () => {
    expect(documentRecipients('Anna@Acme.se', customer)[0]).toEqual({ email: 'anna@acme.se', label: 'Anna' });
  });

  // Gamla offerter sparade före kortfallbacken har ingen adress på snapshoten alls.
  it('utan snapshotadress används kundens adresser', () => {
    expect(documentRecipients('', customer)).toEqual([
      { email: 'anna@acme.se', label: 'Anna' },
      { email: 'info@acme.se', label: 'Kundens adress' },
    ]);
    expect(documentRecipients(null, customer)).toHaveLength(2);
  });

  // Kunduppslaget är best-effort — misslyckas det ska snapshoten fortfarande gå fram.
  it('utan kund används enbart snapshotadressen', () => {
    expect(documentRecipients('kund@acme.se', null, 'Från offerten')).toEqual([{ email: 'kund@acme.se', label: 'Från offerten' }]);
    expect(documentRecipients('', null)).toEqual([]);
  });

  // En enda kandidat betyder att UI:t hoppar över mottagarvalet helt — privatkunden
  // ska aldrig få en extra klick.
  // Etiketten måste följa dokumenttypen — "Från offerten" på en orderbekräftelse är fel.
  it('snapshotetiketten är styrbar och har en neutral default', () => {
    expect(documentRecipients('x@y.se', null, 'Från ordern')[0].label).toBe('Från ordern');
    expect(documentRecipients('x@y.se', null)[0].label).toBe('Från dokumentet');
  });

  it('kund utan kontaktrader ger exakt en kandidat', () => {
    expect(documentRecipients('info@acme.se', { email: 'info@acme.se', contacts: [] })).toHaveLength(1);
  });
});
