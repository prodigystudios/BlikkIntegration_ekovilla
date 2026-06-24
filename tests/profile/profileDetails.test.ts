import { describe, it, expect } from 'vitest';
import {
  buildSelfProfileUpdates,
  mergeEmployeeProfile,
  mergeSensitiveStatus,
} from '@/lib/profileDetails';

describe('buildSelfProfileUpdates', () => {
  it('tar bara med self-editable fält och normaliserar (trim → null för tomt)', () => {
    const updates = buildSelfProfileUpdates({
      full_name: '  Anna  ',
      phone: '',
      // fält utanför self-editable ska ignoreras
      role: 'admin',
      blikk_id: 5,
    });
    expect(updates.full_name).toBe('Anna');
    expect(updates.phone).toBeNull();
    expect('role' in updates).toBe(false);
    expect('blikk_id' in updates).toBe(false);
  });

  it('hoppar över fält som inte finns i input', () => {
    const updates = buildSelfProfileUpdates({ city: 'Uppsala' });
    expect(Object.keys(updates)).toEqual(['city']);
  });
});

describe('mergeEmployeeProfile', () => {
  it('returnerar null utan giltig profilrad (saknar id/role)', () => {
    expect(mergeEmployeeProfile(null, null)).toBeNull();
    expect(mergeEmployeeProfile({ id: 'x' } as any, null)).toBeNull();
  });

  it('slår ihop profil + detaljer och normaliserar', () => {
    const profile = mergeEmployeeProfile(
      { id: 'u1', role: 'member', full_name: '  Bo ', phone: '', tags: ['a', 2 as any], blikk_id: 7 } as any,
      { job_title: ' Montör ', employment_start_date: '2024-01-02' } as any,
    );
    expect(profile).not.toBeNull();
    expect(profile!.full_name).toBe('Bo');
    expect(profile!.phone).toBeNull();
    expect(profile!.job_title).toBe('Montör');
    expect(profile!.tags).toEqual(['a']); // icke-strängar filtreras bort
    expect(profile!.blikk_id).toBe(7);
  });
});

describe('mergeSensitiveStatus', () => {
  it('maskerar personnummer och bankuppgifter + sätter has-flaggor', () => {
    const status = mergeSensitiveStatus({
      personal_identity_number: '19900101-1234',
      bank_account_name: 'Anna Svensson',
      bank_account_number: '1234 5678 9012',
      bank_clearing_number: '8327',
      updated_at: '2026-01-01T00:00:00.000Z',
    } as any);
    expect(status.has_personal_identity_number).toBe(true);
    expect(status.personal_identity_number_masked).toBe('******-1234');
    expect(status.has_bank_details).toBe(true);
    // maskerat, inte klartext
    expect(status.bank_account_number_masked).not.toBe('1234 5678 9012');
    expect(status.bank_account_number_masked).toMatch(/9012$/);
    expect(status.bank_account_name_masked).not.toBe('Anna Svensson');
  });

  it('tomma uppgifter ger false/null', () => {
    const status = mergeSensitiveStatus({} as any);
    expect(status.has_personal_identity_number).toBe(false);
    expect(status.personal_identity_number_masked).toBeNull();
    expect(status.has_bank_details).toBe(false);
  });
});
