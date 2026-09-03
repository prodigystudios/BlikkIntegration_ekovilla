import { describe, it, expect } from 'vitest';

import { resolveDocumentContact } from '@/lib/domains/crm/contacts';

// Den DELADE regeln för "vem ringer man om det här dokumentet". Låg tidigare bara inne i
// getWorkOrderCustomerContact och prövades bara därigenom; nu läser offertpanelen och
// uppgiftslistan samma funktion, så kontraktet prövas för sig.
//
// tests/crm/workOrderCustomerContact.test.ts prövar fortfarande hela vägen genom arbetsordern
// (två databasläsningar + felhantering). Det här testet prövar regeln, inte vägen fram till den.
//
// EN källa i taget, aldrig fält för fält mellan två personer:
//   1. slutkunden på plats (end_contact_*) — lånar numret, aldrig adressen
//   2. dokumentets egen kontakt (snapshoten)
//   3. kundkortet

const ACME = {
  customer_type: 'business' as const,
  email: 'robert@acme.se',
  phone: '08-000',
  mobile: null,
  contacts: [
    { name: 'Anna', email: 'anna@acme.se', phone: '08-111', is_primary: true },
    { name: 'Björn', email: 'bjorn@acme.se', phone: '08-222' },
  ],
};

describe('resolveDocumentContact', () => {
  it('dokumentets egen kontakt går före kortets primärkontakt', () => {
    const contact = resolveDocumentContact(
      { contact_name: 'Björn', phone: '08-222', email: 'bjorn@acme.se' },
      ACME,
    );
    expect(contact).toMatchObject({ contactName: 'Björn', phone: '08-222', email: 'bjorn@acme.se', isOnSiteContact: false });
  });

  it('en snapshot med bara ett namn slår upp personen på kortet', () => {
    const contact = resolveDocumentContact({ contact_name: 'Björn' }, ACME);
    expect(contact).toMatchObject({ contactName: 'Björn', phone: '08-222', email: 'bjorn@acme.se' });
  });

  it('namnet matchas skiftlägesokänsligt — annars tömdes adressen på en bomma', () => {
    expect(resolveDocumentContact({ contact_name: 'anna' }, ACME)).toMatchObject({ email: 'anna@acme.se' });
  });

  // 🧨 En snapshot med bara ett nummer är ingen VALD PERSON. Trängde den undan kortets namngivna
  // kontakt visade vyn ett naket nummer utan namn. Men numret självt tillskrivs ingen, så
  // dokumentets eget vinner ändå.
  it('snapshot med bara ett nummer: kortets namn, dokumentets nummer', () => {
    expect(resolveDocumentContact({ phone: '08-999' }, ACME))
      .toMatchObject({ contactName: 'Anna', phone: '08-999', email: 'anna@acme.se' });
  });

  it('tom snapshot faller tillbaka på kortets primärkontakt', () => {
    expect(resolveDocumentContact({}, ACME)).toMatchObject({ contactName: 'Anna', phone: '08-111', email: 'anna@acme.se' });
  });

  it('utan snapshot alls faller den också tillbaka på kortet', () => {
    expect(resolveDocumentContact(null, ACME)).toMatchObject({ contactName: 'Anna', phone: '08-111' });
  });

  // ⚠️ Regeln från contacts.ts huvudkommentar: kortets adress tillhör KUNDEN. Att låna ut den åt
  // en anställd satte en persons namn bredvid en annans adress.
  it('företagskontakt utan egen adress ärver inte bolagets — men lånar numret', () => {
    expect(resolveDocumentContact({ contact_name: 'Jonas' }, ACME))
      .toMatchObject({ contactName: 'Jonas', phone: '08-000', email: null });
  });

  it('privatkundens kontaktrad ÄR kunden och ärver därför kortets adress', () => {
    const contact = resolveDocumentContact({ contact_name: 'Anna Andersson' }, {
      customer_type: 'private',
      email: 'anna@example.se',
      phone: '070-1',
      mobile: null,
      contacts: [{ name: 'Anna Andersson', email: null, phone: null, is_primary: true }],
    });
    expect(contact).toMatchObject({ contactName: 'Anna Andersson', phone: '070-1', email: 'anna@example.se' });
  });

  it('kundens egen adress följer med separat, även när kontakten saknar egen', () => {
    expect(resolveDocumentContact({ contact_name: 'Jonas' }, ACME))
      .toMatchObject({ email: null, customerEmail: 'robert@acme.se' });
  });

  describe('slutkunden på plats', () => {
    it('vinner och ärver ingen adress', () => {
      expect(resolveDocumentContact(
        { end_contact_name: 'Fastighetsskötaren', end_contact_phone: '070-9', contact_name: 'Anna', email: 'anna@acme.se' },
        ACME,
      )).toEqual({
        contactName: 'Fastighetsskötaren',
        phone: '070-9',
        email: null,
        customerEmail: 'robert@acme.se',
        isOnSiteContact: true,
        phoneFromCustomer: false,
      });
    });

    // 🧨 Lånet MÅSTE gå att se. Utan flaggan skrivs "Kontakt på plats · Fastighetsskötaren" rakt
    // över kundens växelnummer, och man ringer och frågar efter någon som inte sitter där.
    it('utan eget nummer lånar den kundens — och flaggar lånet', () => {
      const contact = resolveDocumentContact(
        { end_contact_name: 'Fastighetsskötaren', contact_name: 'Anna', phone: '08-111' },
        ACME,
      );
      expect(contact).toMatchObject({ contactName: 'Fastighetsskötaren', phone: '08-111', phoneFromCustomer: true });
    });

    it('med eget nummer flaggar inget lån', () => {
      expect(resolveDocumentContact(
        { end_contact_name: 'Ulla', end_contact_phone: '070-333', contact_name: 'Anna', phone: '08-111' },
        ACME,
      )).toMatchObject({ phone: '070-333', phoneFromCustomer: false });
    });

    // Slutkunden fångas utanför kundkortet och måste därför fungera helt utan kort — en
    // prospekt-/snapshotoffert har inget.
    it('besvaras även utan kundkort', () => {
      expect(resolveDocumentContact({ end_contact_name: 'Ulla', end_contact_phone: '070-333' }, null))
        .toMatchObject({ contactName: 'Ulla', phone: '070-333', isOnSiteContact: true, customerEmail: null });
    });
  });

  // ⚠️ Offertpanelen ritar inget kontaktblock på null. En snapshotoffert utan kundkoppling som
  // ändå bär en kontakt måste därför svara med något — annars försvinner Er referens ur vyn.
  it('utan kundkort används dokumentets egen kontakt', () => {
    expect(resolveDocumentContact({ contact_name: 'Björn', phone: '08-222' }, null))
      .toMatchObject({ contactName: 'Björn', phone: '08-222', email: null, customerEmail: null });
  });

  it('varken kontakt eller kortadress → null, inget att visa', () => {
    expect(resolveDocumentContact({}, null)).toBeNull();
    expect(resolveDocumentContact(null, null)).toBeNull();
    expect(resolveDocumentContact({}, { customer_type: 'business', email: null, phone: null, mobile: null, contacts: [] })).toBeNull();
  });

  // Kortet bär bara en adress, ingen kontaktperson: det är fortfarande något att visa (och att
  // mejla), så funktionen får inte svara null.
  it('bara en kortadress räcker för att svara', () => {
    expect(resolveDocumentContact({}, { customer_type: 'business', email: 'info@acme.se', phone: null, mobile: null, contacts: [] }))
      .toMatchObject({ contactName: null, phone: null, customerEmail: 'info@acme.se' });
  });

  // ⚠️ Blanksteg är inte ett värde. En snapshot vars namn är " " får inte räknas som en vald
  // person — då hade kortets riktiga kontakt trängts undan av ingenting.
  it('blanka snapshotfält räknas inte som ifyllda', () => {
    expect(resolveDocumentContact({ contact_name: '   ', phone: '  ' }, ACME))
      .toMatchObject({ contactName: 'Anna', phone: '08-111' });
  });
});
