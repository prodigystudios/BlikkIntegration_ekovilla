import { describe, it, expect } from 'vitest';
import { customerDisplayName, customerInitials } from '@/app/crm/lib/customerDisplay';

const business = (company_name: string | null) => ({ customer_type: 'business' as const, company_name, first_name: null, last_name: null });
const person = (first_name: string | null, last_name: string | null) => ({ customer_type: 'private' as const, company_name: null, first_name, last_name });

describe('customerDisplayName', () => {
  it('företaget heter sitt företagsnamn, privatpersonen för- och efternamn', () => {
    expect(customerDisplayName(business('Testbolaget Bygg AB'))).toBe('Testbolaget Bygg AB');
    expect(customerDisplayName(person('Anna', 'Lindqvist'))).toBe('Anna Lindqvist');
    expect(customerDisplayName(person('Anna', null))).toBe('Anna');
  });

  it('säger vad som saknas i stället för en tom rad — även när namnet bara är blanksteg', () => {
    expect(customerDisplayName(business(null))).toBe('Okänt företag');
    expect(customerDisplayName(business('   '))).toBe('Okänt företag');
    expect(customerDisplayName(person(null, null))).toBe('Okänd kund');
    expect(customerDisplayName(person(' ', ''))).toBe('Okänd kund');
  });
});

describe('customerInitials', () => {
  it('företag: de två första orden, eller två bokstäver ur ett ensamt ord', () => {
    expect(customerInitials(business('Testbolaget Bygg AB'))).toBe('TB');
    expect(customerInitials(business('ekovilla'))).toBe('EK');
  });

  it('företag utan namn får "?" — samma kund som heter "Okänt företag" bredvid', () => {
    expect(customerInitials(business(null))).toBe('?');
    expect(customerInitials(business('   '))).toBe('?');
    expect(customerInitials({ customer_type: 'business', company_name: null, first_name: 'Anna', last_name: 'Lind' })).toBe('?');
  });

  it('tar hela tecken: ett sammansatt Å och en emoji delas inte på mitten', () => {
    expect(customerInitials(business('A\u030Akeri Bygg'))).toBe('ÅB');
    expect(customerInitials(business('🏠 Bygg AB'))).toBe('🏠B');
    expect(customerInitials(person('Åsa', 'Öberg'))).toBe('ÅÖ');
  });

  it('privatperson: för- och efternamnets första bokstav', () => {
    expect(customerInitials(person('anna', 'lindqvist'))).toBe('AL');
    expect(customerInitials(person('Anna', null))).toBe('A');
    expect(customerInitials(person(null, null))).toBe('?');
  });
});
