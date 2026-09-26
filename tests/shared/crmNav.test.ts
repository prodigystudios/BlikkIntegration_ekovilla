import { describe, it, expect } from 'vitest';
import { getVisibleCrmNavItems } from '@/app/crm/_lib/nav';
import type { UserRole } from '@/lib/roles';
import { keysForRole } from '../helpers/permissionSeed';

/**
 * CRM:ets sidomeny per roll, som den såg ut FÖRE bytet från roller till nycklar (fryst ur den
 * rollstyrda getVisibleCrmNavItems(toEffectiveRole(roll)) 2026-09-26). Med rollens nycklar i prod ska
 * varje roll se exakt samma rader. Ändras menyn MED FLIT uppdateras listan här i samma ändring.
 */
type Shape = (string | Record<string, string[]>)[];
const CRM_NAV_BEFORE_KEYS: Record<UserRole, Shape> = {
  member: [],
  sales: ['/crm', '/crm/kunder', '/crm/offerter', '/crm/arbetsorder', '/crm/planering', '/crm/samtal', '/crm/uppgifter', '/crm/saljtavla', '/crm/rapportering', '/crm/coach', '/crm/dokument', '/crm/korjournal'],
  admin: ['/crm', '/crm/kunder', '/crm/offerter', '/crm/arbetsorder', '/crm/planering', '/crm/samtal', '/crm/uppgifter', '/crm/saljtavla', '/crm/rapportering', '/crm/ringlistor', '/crm/ai-prospekt', '/crm/coach', '/crm/dokument', '/crm/korjournal', {'/crm/installningar':  ['/crm/installningar', '/crm/installningar/artiklar', '/crm/installningar/enheter']}],
  konsult: ['/crm', '/crm/kunder', '/crm/offerter', '/crm/arbetsorder', '/crm/planering', '/crm/samtal', '/crm/uppgifter', '/crm/saljtavla', '/crm/rapportering', '/crm/coach', '/crm/dokument', '/crm/korjournal'],
  ekonomi: [],
};

function shape(role: UserRole): Shape {
  const keys = keysForRole(role);
  return getVisibleCrmNavItems((key) => keys.has(key)).map((item) =>
    item.children ? { [item.href]: item.children.map((c) => c.href) } : item.href,
  );
}

describe('CRM-menyn med nycklar = CRM-menyn före bytet', () => {
  it.each(Object.keys(CRM_NAV_BEFORE_KEYS) as UserRole[])('%s', (role) => {
    expect(shape(role)).toEqual(CRM_NAV_BEFORE_KEYS[role]);
  });

  it('utan nycklar syns ingen CRM-rad', () => {
    expect(getVisibleCrmNavItems(() => false)).toEqual([]);
  });
});
