import { describe, it, expect } from 'vitest';

import {
  applyContactToList,
  buildContactPayload,
  contactDraftError,
  draftFromContact,
  initialContactDraft,
  type ContactDraft,
  type CrmContactItem,
} from '@/app/crm/lib/contactForm';
// Det RIKTIGA schemat rutten använder. Poängen med testet: Zod strippar okända nycklar tyst, så
// ett felstavat fältnamn i nyttolasten hade försvunnit utan ett ord — precis som `prospect_id`
// gjorde på uppföljningsuppgiften i över ett år. Här faller det i stället på ett rött test.
import {
  createCrmCustomerContactSchema,
  updateCrmCustomerContactSchema,
} from '@/app/api/crm/customers/_lib';

const draft = (over: Partial<ContactDraft> = {}): ContactDraft => ({ ...initialContactDraft, ...over });

describe('buildContactPayload', () => {
  it('skickar alla fälten schemat känner till — inget strippas', () => {
    const payload = buildContactPayload(draft({
      name: 'Anna Svensson', role: 'Inköpschef', phone: '070-123 45 67', email: 'anna@acme.se', is_primary: true,
    }));

    const parsed = createCrmCustomerContactSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    // Ingen nyckel får försvinna på vägen genom schemat.
    expect(parsed.success && parsed.data).toEqual({
      name: 'Anna Svensson', role: 'Inköpschef', phone: '070-123 45 67', email: 'anna@acme.se', is_primary: true,
    });
    expect(Object.keys(payload).sort()).toEqual(['email', 'is_primary', 'name', 'phone', 'role']);
  });

  // 🧨 Hela skälet till att tomma fält blir null. `intlEmail` prövar adressens form FÖRE
  // .nullable(), så en tom sträng är inte "ingen adress" — den är en ogiltig adress, och
  // sparningen svarar 400 på ett fält säljaren medvetet lämnade tomt.
  it('tom e-post blir null och passerar — tom sträng hade gett 400', () => {
    const payload = buildContactPayload(draft({ name: 'Anna' }));
    expect(payload.email).toBeNull();
    expect(createCrmCustomerContactSchema.safeParse(payload).success).toBe(true);

    // Beviset för att nollan behövs: samma nyttolast med tom sträng avvisas.
    expect(createCrmCustomerContactSchema.safeParse({ ...payload, email: '' }).success).toBe(false);
  });

  it('tomma roll- och telefonfält blir null, inte tomma strängar', () => {
    const payload = buildContactPayload(draft({ name: 'Anna', role: '   ', phone: '' }));
    expect(payload).toMatchObject({ role: null, phone: null });
  });

  it('trimmar namnet', () => {
    expect(buildContactPayload(draft({ name: '  Anna  ' })).name).toBe('Anna');
  });

  it('duger även som PATCH-nyttolast', () => {
    const payload = buildContactPayload(draft({ name: 'Anna', email: 'anna@acme.se' }));
    expect(updateCrmCustomerContactSchema.safeParse(payload).success).toBe(true);
  });

  // Unicode-domäner: repot bytte medvetet ut Zods .email() mot en egen kontroll för att
  // byggmästaren.se ska gå att spara. Nyttolasten får inte återinföra begränsningen.
  it('släpper igenom en IDN-domän', () => {
    const payload = buildContactPayload(draft({ name: 'Sven', email: 'sven@byggmästaren.se' }));
    expect(createCrmCustomerContactSchema.safeParse(payload).success).toBe(true);
  });

  it('ett namnlöst utkast avvisas av både formuläret och schemat', () => {
    expect(contactDraftError(draft({ name: '  ' }))).toBe('Namn krävs');
    expect(createCrmCustomerContactSchema.safeParse(buildContactPayload(draft())).success).toBe(false);
  });

  it('ett ifyllt namn passerar', () => {
    expect(contactDraftError(draft({ name: 'Anna' }))).toBeNull();
  });
});

describe('applyContactToList', () => {
  const anna: CrmContactItem = { id: 'a', name: 'Anna', role: null, phone: null, email: null, is_primary: true };
  const bjorn: CrmContactItem = { id: 'b', name: 'Björn', role: null, phone: null, email: null, is_primary: false };

  it('lägger en ny kontakt sist', () => {
    const cecilia: CrmContactItem = { id: 'c', name: 'Cecilia', role: null, phone: null, email: null, is_primary: false };
    expect(applyContactToList([anna, bjorn], cecilia).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('ersätter en befintlig rad på plats', () => {
    const rattad = { ...bjorn, name: 'Björn Ek' };
    const next = applyContactToList([anna, bjorn], rattad);
    expect(next.map((c) => c.id)).toEqual(['a', 'b']);
    expect(next[1].name).toBe('Björn Ek');
  });

  // 🧨 Kärnan: servern degraderar syskonen, och utan spegling här visar listan två primärbrickor.
  it('en ny primär degraderar den gamla', () => {
    const next = applyContactToList([anna, bjorn], { ...bjorn, is_primary: true });
    expect(next.filter((c) => c.is_primary).map((c) => c.id)).toEqual(['b']);
  });

  it('en ny primär som LÄGGS TILL degraderar också', () => {
    const cecilia: CrmContactItem = { id: 'c', name: 'Cecilia', role: null, phone: null, email: null, is_primary: true };
    const next = applyContactToList([anna, bjorn], cecilia);
    expect(next.filter((c) => c.is_primary).map((c) => c.id)).toEqual(['c']);
  });

  // Motsatsen måste också hålla: en vanlig kontakt får inte råka nolla den primära.
  it('en icke-primär rör inte den befintliga primären', () => {
    const next = applyContactToList([anna, bjorn], { ...bjorn, name: 'Björn Ek' });
    expect(next.filter((c) => c.is_primary).map((c) => c.id)).toEqual(['a']);
  });

  it('muterar inte listan den fick', () => {
    const list = [anna, bjorn];
    applyContactToList(list, { ...bjorn, is_primary: true });
    expect(list[0].is_primary).toBe(true);
    expect(list).toHaveLength(2);
  });
});

describe('draftFromContact', () => {
  it('null-fält blir tomma strängar så varje Input förblir kontrollerad', () => {
    expect(draftFromContact({ id: 'c1', name: 'Anna', role: null, phone: null, email: null, is_primary: false }))
      .toEqual({ name: 'Anna', role: '', phone: '', email: '', is_primary: false });
  });

  it('går fram och tillbaka utan att tappa något', () => {
    const contact = { id: 'c1', name: 'Anna', role: 'Inköp', phone: '08-1', email: 'a@b.se', is_primary: true };
    const payload = buildContactPayload(draftFromContact(contact));
    expect(payload).toEqual({ name: 'Anna', role: 'Inköp', phone: '08-1', email: 'a@b.se', is_primary: true });
  });
});
