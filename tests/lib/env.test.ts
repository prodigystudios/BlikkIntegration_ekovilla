import { describe, it, expect } from 'vitest';
import { isLocalUrl, isProductionDeployment } from '@/lib/env';
import { isLocalSupabaseUrl } from '@/lib/domains/fortnox/connectionGuard';

describe('isLocalUrl', () => {
  it('känner igen den här datorn, också IPv6 och 0.0.0.0', () => {
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:55321', 'http://0.0.0.0:3001', 'http://[::1]:3000']) {
      expect(isLocalUrl(url)).toBe(true);
    }
  });

  it('en riktig värd, en ogiltig eller saknad adress är inte lokal', () => {
    expect(isLocalUrl('https://prodref.supabase.co')).toBe(false);
    expect(isLocalUrl('https://localhost.example.com')).toBe(false);
    expect(isLocalUrl('inte en adress')).toBe(false);
    expect(isLocalUrl(undefined)).toBe(false);
  });

  it('Fortnox-spärren och skripten använder samma lista', () => {
    for (const url of ['http://0.0.0.0:55321', 'http://[::1]:55321', 'https://prodref.supabase.co', undefined]) {
      expect(isLocalSupabaseUrl(url)).toBe(isLocalUrl(url));
    }
  });
});

describe('isProductionDeployment', () => {
  const prod = { NODE_ENV: 'production', VERCEL_ENV: 'production', SUPABASE_URL: 'https://prodref.supabase.co' };

  it('är prod när alla tre stämmer', () => {
    expect(isProductionDeployment(prod)).toBe(true);
    expect(isProductionDeployment({ ...prod, SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_URL: 'https://prodref.supabase.co' })).toBe(true);
  });

  it('faller stängt: det räcker att en av dem inte stämmer', () => {
    expect(isProductionDeployment({ ...prod, NODE_ENV: 'development' })).toBe(false);
    expect(isProductionDeployment({ ...prod, VERCEL_ENV: undefined })).toBe(false);
    expect(isProductionDeployment({ ...prod, VERCEL_ENV: 'preview' })).toBe(false);
    expect(isProductionDeployment({ ...prod, SUPABASE_URL: 'http://127.0.0.1:55321' })).toBe(false);
    expect(isProductionDeployment({})).toBe(false);
  });
});
