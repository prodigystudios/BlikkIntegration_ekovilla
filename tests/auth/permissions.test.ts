import { describe, it, expect } from 'vitest';
import { can, PERMISSION_KEYS, type PermissionKey } from '@/lib/auth/permissions';

describe('can', () => {
  it('returns true only when the permission is in the set', () => {
    const perms = new Set<PermissionKey>(['crm.offer.read', 'crm.offer.write']);
    expect(can(perms, 'crm.offer.read')).toBe(true);
    expect(can(perms, 'crm.offer.write')).toBe(true);
    expect(can(perms, 'crm.customer.write')).toBe(false);
    expect(can(perms, 'crm.admin')).toBe(false);
  });

  it('an empty set grants nothing (fail-closed default)', () => {
    const perms = new Set<PermissionKey>();
    expect(can(perms, 'crm.access')).toBe(false);
  });
});

describe('PERMISSION_KEYS catalog', () => {
  // Mirrors the SQL `permissions` catalog in 20260608_permissions_model.sql. If you add a key
  // there, add it here too (and to the seed + parity assert) — this guards the count.
  it('has the expected count and no duplicates', () => {
    expect(PERMISSION_KEYS.length).toBe(35);
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('includes the meta keys backing the legacy guards', () => {
    for (const key of ['crm.access', 'crm.write', 'crm.admin'] as const) {
      expect(PERMISSION_KEYS).toContain(key);
    }
  });

  it('includes a read+write pair for every core CRM resource', () => {
    const resources = ['prospect', 'call', 'customer', 'contact', 'opportunity', 'offer', 'workorder', 'task'];
    for (const r of resources) {
      expect(PERMISSION_KEYS).toContain(`crm.${r}.read`);
      expect(PERMISSION_KEYS).toContain(`crm.${r}.write`);
    }
  });

  it('includes the Fortnox bookkeeping action keys', () => {
    for (const key of ['fortnox.offer.push', 'fortnox.workorder.push', 'fortnox.invoice.create', 'fortnox.customer.sync', 'fortnox.read'] as const) {
      expect(PERMISSION_KEYS).toContain(key);
    }
  });
});
