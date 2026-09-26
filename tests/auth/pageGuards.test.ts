import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sidgrinden: nyckeln finns → sidan renderar; saknas → redirect till `deniedTo`. `redirect()` kastar i
// Next; här kastar mocken också, så att koden efter en nekad grind aldrig körs — precis som i drift.

const h = vi.hoisted(() => ({ held: new Set<string>() }));

vi.mock('@/lib/auth/permissions', () => ({ getEffectivePermissions: async () => h.held }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { requirePagePermission } from '@/lib/auth/pageGuards';

describe('requirePagePermission', () => {
  beforeEach(() => {
    h.held = new Set();
  });

  it('släpper igenom den som har nyckeln', async () => {
    h.held = new Set(['app.access']);
    await expect(requirePagePermission('app.access')).resolves.toBeUndefined();
  });

  it('skickar den som saknar nyckeln till Start', async () => {
    h.held = new Set(['crm.access']);
    await expect(requirePagePermission('app.access')).rejects.toThrow('REDIRECT /');
  });

  it('skickar till det angivna målet', async () => {
    await expect(requirePagePermission('crm.article.manage', '/crm')).rejects.toThrow('REDIRECT /crm');
  });

  // Utan session (eller om läsningen misslyckades) är mängden tom — grinden failar stängt.
  it('nekar med en tom mängd', async () => {
    await expect(requirePagePermission('app.access')).rejects.toThrow('REDIRECT /');
  });
});
