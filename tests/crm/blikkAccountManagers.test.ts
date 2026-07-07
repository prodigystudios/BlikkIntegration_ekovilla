import { describe, it, expect } from 'vitest';
import {
  interpretIsCompany,
  extractSellerBlikkId,
  normalizeCustomerNumber,
  normalizeBlikkContact,
  resolveAccountManagerUpdates,
  type NormalizedBlikkContact,
} from '@/lib/domains/crm/blikkAccountManagers';

describe('interpretIsCompany', () => {
  it('treats company-ish strings as company', () => {
    expect(interpretIsCompany('Company')).toBe(true);
    expect(interpretIsCompany('Organization')).toBe(true);
    expect(interpretIsCompany('Företag')).toBe(true);
  });
  it('treats person-ish strings as private', () => {
    expect(interpretIsCompany('Private')).toBe(false);
    expect(interpretIsCompany('Person')).toBe(false);
    expect(interpretIsCompany('Privat')).toBe(false);
  });
  it('reads a nested { name } object', () => {
    expect(interpretIsCompany({ name: 'Company' })).toBe(true);
    expect(interpretIsCompany({ name: 'Person' })).toBe(false);
  });
  it('defaults to not-company for null/unknown', () => {
    expect(interpretIsCompany(null)).toBe(false);
    expect(interpretIsCompany('')).toBe(false);
    expect(interpretIsCompany('weird')).toBe(false);
  });
});

describe('extractSellerBlikkId', () => {
  it('reads a direct sales-responsible id (preferred over generic responsible)', () => {
    expect(extractSellerBlikkId({ salesResponsibleId: 42, responsibleId: 7 })).toBe(42);
  });
  it('reads a nested responsible object', () => {
    expect(extractSellerBlikkId({ responsible: { id: 99 } })).toBe(99);
  });
  it('returns null when no seller present or invalid', () => {
    expect(extractSellerBlikkId({})).toBeNull();
    expect(extractSellerBlikkId({ salesResponsibleId: 0 })).toBeNull();
    expect(extractSellerBlikkId({ responsibleId: 'abc' })).toBeNull();
  });
});

describe('normalizeCustomerNumber', () => {
  it('coerces to a trimmed string, matching text fortnox_customer_id', () => {
    expect(normalizeCustomerNumber(1001)).toBe('1001');
    expect(normalizeCustomerNumber('  1001 ')).toBe('1001');
  });
  it('returns null for empty/nullish', () => {
    expect(normalizeCustomerNumber(null)).toBeNull();
    expect(normalizeCustomerNumber('')).toBeNull();
  });
});

describe('normalizeBlikkContact', () => {
  it('pulls id, customerNumber, isCompany and sellerBlikkId from a raw list item', () => {
    const raw = { id: 5, customerNumber: '1001', contactType: 'Company', salesResponsibleId: 42 };
    expect(normalizeBlikkContact(raw)).toEqual({
      id: 5, customerNumber: '1001', isCompany: true, sellerBlikkId: 42,
    });
  });
});

describe('resolveAccountManagerUpdates', () => {
  const blikkIdToProfile = new Map<number, string>([[42, 'profile-a'], [43, 'profile-b']]);
  const customerNumberToId = new Map<string, string>([['1001', 'cust-1'], ['1002', 'cust-2']]);

  const c = (over: Partial<NormalizedBlikkContact>): NormalizedBlikkContact => ({
    id: 1, customerNumber: '1001', isCompany: true, sellerBlikkId: 42, ...over,
  });

  it('maps a company contact with a mapped seller to an update', () => {
    const r = resolveAccountManagerUpdates([c({})], blikkIdToProfile, customerNumberToId);
    expect(r.updates).toEqual([{ customerId: 'cust-1', accountManagerId: 'profile-a' }]);
  });

  it('filters out private contacts before anything else', () => {
    const r = resolveAccountManagerUpdates([c({ isCompany: false })], blikkIdToProfile, customerNumberToId);
    expect(r.updates).toHaveLength(0);
    expect(r.skippedPrivate).toBe(1);
  });

  it('reports a company whose customer number has no CRM match', () => {
    const r = resolveAccountManagerUpdates([c({ customerNumber: '9999' })], blikkIdToProfile, customerNumberToId);
    expect(r.updates).toHaveLength(0);
    expect(r.unmatchedCustomer).toEqual(['9999']);
  });

  it('reports a seller with no blikk_id mapping (left blank, not written)', () => {
    const r = resolveAccountManagerUpdates([c({ sellerBlikkId: 777 })], blikkIdToProfile, customerNumberToId);
    expect(r.updates).toHaveLength(0);
    expect(r.unmappedSeller).toEqual([{ customerNumber: '1001', sellerBlikkId: 777 }]);
  });

  it('leaves a company with no seller on the Blikk contact untouched', () => {
    const r = resolveAccountManagerUpdates([c({ sellerBlikkId: null })], blikkIdToProfile, customerNumberToId);
    expect(r.updates).toHaveLength(0);
    expect(r.noSeller).toBe(1);
  });

  it('skips a contact missing a customer number', () => {
    const r = resolveAccountManagerUpdates([c({ customerNumber: null })], blikkIdToProfile, customerNumberToId);
    expect(r.updates).toHaveLength(0);
    expect(r.unmatchedCustomer).toHaveLength(0);
  });

  it('handles a mixed batch and buckets each contact once', () => {
    const batch = [
      c({ customerNumber: '1001', sellerBlikkId: 42 }),      // → update
      c({ customerNumber: '1002', sellerBlikkId: 43 }),      // → update
      c({ isCompany: false }),                                // private
      c({ customerNumber: '9999' }),                          // unmatched
      c({ customerNumber: '1002', sellerBlikkId: 777 }),      // unmapped seller
    ];
    const r = resolveAccountManagerUpdates(batch, blikkIdToProfile, customerNumberToId);
    expect(r.updates).toEqual([
      { customerId: 'cust-1', accountManagerId: 'profile-a' },
      { customerId: 'cust-2', accountManagerId: 'profile-b' },
    ]);
    expect(r.skippedPrivate).toBe(1);
    expect(r.unmatchedCustomer).toEqual(['9999']);
    expect(r.unmappedSeller).toEqual([{ customerNumber: '1002', sellerBlikkId: 777 }]);
  });
});
