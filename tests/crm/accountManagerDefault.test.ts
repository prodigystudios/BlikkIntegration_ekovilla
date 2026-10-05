import { describe, it, expect } from 'vitest';
import { defaultAccountManagerId } from '@/app/crm/kunder/accountManagerDefault';

const sellers = [{ id: 'saljare-1' }, { id: 'admin-1' }];

describe('defaultAccountManagerId', () => {
  it('förväljer den som skapar kunden när hen står i säljarkatalogen', () => {
    expect(defaultAccountManagerId('', sellers, 'saljare-1')).toBe('saljare-1');
    expect(defaultAccountManagerId('', sellers, 'admin-1')).toBe('admin-1');
  });

  it('lämnar tomt för den som inte är säljare (ett id utan alternativ i rullistan)', () => {
    expect(defaultAccountManagerId('', sellers, 'ekonomi-1')).toBe('');
  });

  it('lämnar tomt utan inloggad användare', () => {
    expect(defaultAccountManagerId('', sellers, null)).toBe('');
    expect(defaultAccountManagerId('', sellers, undefined)).toBe('');
  });

  it('lämnar tomt medan katalogen är tom', () => {
    expect(defaultAccountManagerId('', [], 'saljare-1')).toBe('');
  });

  it('skriver aldrig över ett värde som redan står i fältet', () => {
    expect(defaultAccountManagerId('admin-1', sellers, 'saljare-1')).toBe('admin-1');
  });
});
