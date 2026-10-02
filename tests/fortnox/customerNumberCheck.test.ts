import { describe, it, expect, vi } from 'vitest';

// Pekar våra kundkort på rätt kund i Fortnox? (lib/domains/fortnox/customerNumberCheck.ts, körs av
// scripts/fortnox/check-customer-numbers.ts). Fortnox återanvänder kundnummer, så ett kort kan peka på en kund som
// inte är dess egen. Prövas: vad som räknas som fynd, vad som avgjorde det, och ordningen i rapporten.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

import { checkCustomerLinks, type FortnoxListedCustomer, type LinkedCustomerRow } from '@/lib/domains/fortnox/customerNumberCheck';

const card = (over: Partial<LinkedCustomerRow>): LinkedCustomerRow => ({
  id: 'kort-1',
  customer_type: 'business',
  company_name: 'Andersson Bygg AB',
  first_name: null,
  last_name: null,
  organization_number: '556000-0001',
  personal_number: null,
  fortnox_customer_id: '21',
  quotes: 0,
  work_orders: 0,
  ...over,
});
const fortnox = (CustomerNumber: string, Name: string | null, OrganisationNumber: string | null): FortnoxListedCustomer =>
  ({ CustomerNumber, Name, OrganisationNumber });

describe('checkCustomerLinks', () => {
  it('samma kund bakom numret → inget fynd', () => {
    const report = checkCustomerLinks([card({})], [fortnox('21', 'Andersson Bygg AB', '5560000001')]);
    expect(report).toEqual({ checked: 1, ok: 1, findings: [] });
  });

  it('🧨 numret tillhör en annan kund — org.nr skiljer → säkert fynd', () => {
    const report = checkCustomerLinks([card({})], [fortnox('21', 'Nilsson Måleri AB', '559999-9999')]);
    expect(report.ok).toBe(0);
    expect(report.findings).toEqual([
      { kind: 'other_customer', row: card({}), fortnox: fortnox('21', 'Nilsson Måleri AB', '559999-9999'), basis: 'org_number' },
    ]);
  });

  it('samma org.nr men annat namn → inget fynd (ett namnbyte, inte en annan kund)', () => {
    expect(checkCustomerLinks([card({})], [fortnox('21', 'Andersson Bygg & Måleri AB', '556000-0001')]).findings).toEqual([]);
  });

  it('inget org.nr att jämföra → namnet avgör, och fyndet säger det', () => {
    const report = checkCustomerLinks([card({ organization_number: null })], [fortnox('21', 'Nilsson Måleri AB', '559999-9999')]);
    expect(report.findings[0]).toMatchObject({ kind: 'other_customer', basis: 'name' });
    expect(checkCustomerLinks([card({ organization_number: null })], [fortnox('21', 'andersson  bygg ab', null)]).findings).toEqual([]);
  });

  it('privatkunden jämförs på personnumret (12 mot 10 siffror)', () => {
    const person = card({ customer_type: 'private', company_name: null, first_name: 'Anna', last_name: 'Berg', organization_number: null, personal_number: '19800101-1234' });
    expect(checkCustomerLinks([person], [fortnox('21', 'Anna Berg', '800101-1234')]).findings).toEqual([]);
    expect(checkCustomerLinks([person], [fortnox('21', 'Anna Berg', '900101-1234')]).findings[0]).toMatchObject({ basis: 'org_number' });
  });

  it('numret finns inte i Fortnox → fynd, med Fortnox-kunder som har kortets org.nr', () => {
    const report = checkCustomerLinks([card({})], [fortnox('34', 'Andersson Bygg AB', '5560000001'), fortnox('35', 'Annan AB', '5561111111')]);
    expect(report.findings).toEqual([
      { kind: 'missing_in_fortnox', row: card({}), sameNumberElsewhere: [fortnox('34', 'Andersson Bygg AB', '5560000001')] },
    ]);
  });

  it('förslaget matchar personnumret på de tio sista siffrorna (12 på kortet, 10 i Fortnox)', () => {
    const person = card({ customer_type: 'private', company_name: null, first_name: 'Anna', last_name: 'Berg', organization_number: null, personal_number: '19800101-1234' });
    const report = checkCustomerLinks([person], [fortnox('34', 'Anna Berg', '800101-1234')]);
    expect(report.findings).toEqual([{ kind: 'missing_in_fortnox', row: person, sameNumberElsewhere: [fortnox('34', 'Anna Berg', '800101-1234')] }]);
  });

  it('numret finns inte och kortet saknar org.nr → fynd utan förslag', () => {
    const report = checkCustomerLinks([card({ organization_number: null })], [fortnox('34', 'Andersson Bygg AB', '5560000001')]);
    expect(report.findings).toEqual([{ kind: 'missing_in_fortnox', row: card({ organization_number: null }), sameNumberElsewhere: [] }]);
  });

  it('mellanslag runt numret hindrar inte matchningen', () => {
    expect(checkCustomerLinks([card({ fortnox_customer_id: ' 21 ' })], [fortnox('21', 'Andersson Bygg AB', '5560000001')]).ok).toBe(1);
  });

  it('det allvarligaste först: org.nr-fynd, sedan namnfynd, sist saknade — inom gruppen i nummerordning', () => {
    const rows = [
      card({ id: 'saknas', fortnox_customer_id: '5' }),
      card({ id: 'namn', fortnox_customer_id: '3', organization_number: null }),
      card({ id: 'org-12', fortnox_customer_id: '12' }),
      card({ id: 'org-2', fortnox_customer_id: '2' }),
    ];
    const report = checkCustomerLinks(rows, [
      fortnox('3', 'Annan AB', null),
      fortnox('12', 'Annan AB', '5569999999'),
      fortnox('2', 'Annan AB', '5569999999'),
    ]);
    expect(report.findings.map((f) => f.row.id)).toEqual(['org-2', 'org-12', 'namn', 'saknas']);
  });
});
