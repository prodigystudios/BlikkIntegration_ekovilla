import { describe, it, expect } from 'vitest';
import { defaultAccountManager } from '@/app/crm/kunder/accountManagerDefault';

const profile = (role: string, full_name: string | null = 'Test Person') => ({ id: `${role}-1`, role, full_name });

describe('defaultAccountManager', () => {
  it('förväljer en säljare (rollen sales) med namnet', () => {
    expect(defaultAccountManager(profile('sales', 'Test Säljare'))).toEqual({ id: 'sales-1', name: 'Test Säljare' });
  });

  it('förväljer INTE admin, fast admin står i säljarkatalogen', () => {
    expect(defaultAccountManager(profile('admin'))).toBeNull();
  });

  it('förväljer ingen annan roll', () => {
    for (const role of ['konsult', 'ekonomi', 'member']) expect(defaultAccountManager(profile(role))).toBeNull();
  });

  it('förväljer ingen utan profil', () => {
    expect(defaultAccountManager(null)).toBeNull();
  });

  it('faller tillbaka på id:t utan namn, som rullistans alternativ', () => {
    expect(defaultAccountManager(profile('sales', null))).toEqual({ id: 'sales-1', name: 'sales-1' });
  });
});
