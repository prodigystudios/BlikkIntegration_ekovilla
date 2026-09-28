import { describe, it, expect, vi } from 'vitest';
import {
  effectivePermissionKeys,
  portalAssignmentDeps,
  resolvePortalAssignee,
  userCanWriteWorkOrders,
  type AssignmentDeps,
} from '@/lib/domains/portal/assignment';

/**
 * Fördelningen av portalens jobb (fas 3a). Det som skyddas:
 *   - ordningen: butikens säljare, kundansvarig, länet, reserven;
 *   - varje kandidat måste kunna skriva arbetsordrar, annars prövas nästa;
 *   - länet slås upp hos Nominatim bara när steg 1 och 2 inte gav någon;
 *   - finns ingen blir det `none` (jobbet tas inte emot än), aldrig någon godtycklig;
 *   - behörigheten räknas som i databasen: ett borttag vinner.
 */

function deps(overrides: Partial<AssignmentDeps> & { writers?: string[] } = {}) {
  const writers = new Set(overrides.writers ?? ['seller', 'manager', 'county-user', 'fallback']);
  const d = {
    resellerSeller: vi.fn(async () => 'seller' as string | null),
    accountManager: vi.fn(async () => 'manager' as string | null),
    county: vi.fn(async () => 'Gävleborg' as string | null),
    countyUser: vi.fn(async (_c: string) => 'county-user' as string | null),
    fallback: vi.fn(async () => 'fallback' as string | null),
    canWrite: vi.fn(async (id: string) => writers.has(id)),
  };
  return Object.assign(d, overrides);
}

describe('resolvePortalAssignee', () => {
  it('butikens säljare först; inget annat frågas', async () => {
    const d = deps();
    expect(await resolvePortalAssignee(d)).toEqual({ kind: 'assigned', userId: 'seller', source: 'reseller_seller', county: null, skipped: [] });
    expect(d.accountManager).not.toHaveBeenCalled();
    expect(d.county).not.toHaveBeenCalled();
  });

  it('utan butikens säljare: kundansvarig, och länet slås inte upp', async () => {
    const d = deps({ resellerSeller: vi.fn(async () => null) });
    expect(await resolvePortalAssignee(d)).toMatchObject({ kind: 'assigned', userId: 'manager', source: 'account_manager' });
    expect(d.county).not.toHaveBeenCalled();
  });

  it('utan säljare och kundansvarig: säljaren för länet, med länet', async () => {
    const d = deps({ resellerSeller: vi.fn(async () => null), accountManager: vi.fn(async () => null) });
    expect(await resolvePortalAssignee(d)).toEqual({
      kind: 'assigned',
      userId: 'county-user',
      source: 'county',
      county: 'Gävleborg',
      skipped: [],
    });
    expect(d.countyUser).toHaveBeenCalledWith('Gävleborg');
  });

  it('inget län (Nominatim nere): reserven, och ingen regel frågas', async () => {
    const d = deps({ resellerSeller: vi.fn(async () => null), accountManager: vi.fn(async () => null), county: vi.fn(async () => null) });
    expect(await resolvePortalAssignee(d)).toMatchObject({ kind: 'assigned', userId: 'fallback', source: 'fallback', county: null });
    expect(d.countyUser).not.toHaveBeenCalled();
  });

  it('ett län utan regel: reserven, och länet står kvar i svaret', async () => {
    const d = deps({
      resellerSeller: vi.fn(async () => null),
      accountManager: vi.fn(async () => null),
      countyUser: vi.fn(async () => null),
    });
    expect(await resolvePortalAssignee(d)).toMatchObject({ source: 'fallback', county: 'Gävleborg' });
  });

  it('en kandidat som inte kan skriva arbetsordrar hoppas över, och står i svaret', async () => {
    const d = deps({ writers: ['county-user'] });
    expect(await resolvePortalAssignee(d)).toEqual({
      kind: 'assigned',
      userId: 'county-user',
      source: 'county',
      county: 'Gävleborg',
      skipped: [
        { source: 'reseller_seller', userId: 'seller' },
        { source: 'account_manager', userId: 'manager' },
      ],
    });
  });

  it('ingen alls: none, aldrig någon godtycklig', async () => {
    const d = deps({
      resellerSeller: vi.fn(async () => null),
      accountManager: vi.fn(async () => null),
      county: vi.fn(async () => null),
      fallback: vi.fn(async () => null),
    });
    expect(await resolvePortalAssignee(d)).toEqual({ kind: 'none', county: null, skipped: [] });
  });

  it('en reserv som inte kan skriva: none, med reserven bland de överhoppade', async () => {
    const d = deps({ writers: [], resellerSeller: vi.fn(async () => null), accountManager: vi.fn(async () => null), countyUser: vi.fn(async () => null) });
    expect(await resolvePortalAssignee(d)).toEqual({
      kind: 'none',
      county: 'Gävleborg',
      skipped: [{ source: 'fallback', userId: 'fallback' }],
    });
  });

  it('samma användare i flera steg: behörigheten frågas en gång', async () => {
    const same = vi.fn(async () => 'anna' as string | null);
    const d = deps({ writers: [], resellerSeller: same, accountManager: same, countyUser: vi.fn(async () => 'anna'), fallback: same });
    const result = await resolvePortalAssignee(d);
    expect(result.kind).toBe('none');
    expect(d.canWrite).toHaveBeenCalledTimes(1);
    expect(result.skipped.map((s) => s.source)).toEqual(['reseller_seller', 'account_manager', 'county', 'fallback']);
  });

  it('ett fel i ett steg kastas vidare: intaget svarar då 5xx och portalen försöker igen', async () => {
    const d = deps({ resellerSeller: vi.fn(async () => Promise.reject(new Error('Fördelningen: nere'))) });
    await expect(resolvePortalAssignee(d)).rejects.toThrow(/nere/);
  });
});

describe('effectivePermissionKeys', () => {
  it('rollen, plus tillägg, minus borttag; ett borttag vinner', () => {
    expect([...effectivePermissionKeys(['a', 'b'], [{ key: 'c', effect: 'grant' }, { key: 'b', effect: 'revoke' }])].sort()).toEqual(['a', 'c']);
    expect(effectivePermissionKeys([], [{ key: 'x', effect: 'revoke' }, { key: 'x', effect: 'grant' }]).has('x')).toBe(false);
  });
});

/** Minimal service-roll-klient: svaret per tabell, och vad som frågades. */
function fakeAdmin(tables: Record<string, { data: unknown; error?: { message: string } | null }>) {
  const calls: { table: string; filters: [string, unknown][]; select?: string }[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        const call: (typeof calls)[number] = { table, filters: [] };
        calls.push(call);
        const result = () => ({ data: tables[table]?.data ?? null, error: tables[table]?.error ?? null });
        const chain: any = {
          select: (columns: string) => ((call.select = columns), chain),
          eq: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            const r = result();
            return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
          },
          then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
        };
        return chain;
      },
    } as never,
  };
}

describe('userCanWriteWorkOrders', () => {
  it('rollen har nyckeln: kan', async () => {
    const { client, calls } = fakeAdmin({
      profiles: { data: { role: 'sales' } },
      role_permissions: { data: [{ permission_key: 'crm.workorder.write' }] },
      user_permissions: { data: [] },
    });
    expect(await userCanWriteWorkOrders(client, 'u1')).toBe(true);
    expect(calls.find((c) => c.table === 'role_permissions')?.filters).toEqual([
      ['role', 'sales'],
      ['permission_key', 'crm.workorder.write'],
    ]);
  });

  it('rollen har nyckeln men användaren har fått den borttagen: kan inte', async () => {
    const { client } = fakeAdmin({
      profiles: { data: { role: 'sales' } },
      role_permissions: { data: [{ permission_key: 'crm.workorder.write' }] },
      user_permissions: { data: [{ permission_key: 'crm.workorder.write', effect: 'revoke' }] },
    });
    expect(await userCanWriteWorkOrders(client, 'u1')).toBe(false);
  });

  it('rollen saknar nyckeln men användaren har fått den: kan', async () => {
    const { client } = fakeAdmin({
      profiles: { data: { role: 'member' } },
      role_permissions: { data: [] },
      user_permissions: { data: [{ permission_key: 'crm.workorder.write', effect: 'grant' }] },
    });
    expect(await userCanWriteWorkOrders(client, 'u1')).toBe(true);
  });

  it('en profil som saknas kan inte; ett läsfel kastas', async () => {
    expect(await userCanWriteWorkOrders(fakeAdmin({ profiles: { data: null } }).client, 'u1')).toBe(false);
    await expect(userCanWriteWorkOrders(fakeAdmin({ profiles: { data: null, error: { message: 'nere' } } }).client, 'u1')).rejects.toThrow(/nere/);
  });
});

describe('portalAssignmentDeps', () => {
  const job = { resellerId: 'res-norrbygg', customerId: 'cust-1', workplace: { postalCode: '806 28', city: 'Gävle' } };

  it('läser rätt rad i rätt tabell för varje steg', async () => {
    const { client, calls } = fakeAdmin({
      crm_portal_resellers: { data: { seller_user_id: 'seller' } },
      crm_customers: { data: { account_manager_id: 'manager' } },
      crm_portal_settings: { data: { fallback_user_id: 'fallback' } },
    });
    const d = portalAssignmentDeps(client, job);
    expect(await d.resellerSeller()).toBe('seller');
    expect(await d.accountManager()).toBe('manager');
    expect(await d.fallback()).toBe('fallback');
    expect(calls.map((c) => [c.table, c.filters])).toEqual([
      ['crm_portal_resellers', [['reseller_id', 'res-norrbygg']]],
      ['crm_customers', [['id', 'cust-1']]],
      ['crm_portal_settings', [['id', true]]],
    ]);
  });

  it('utan kund frågas ingen kundansvarig', async () => {
    const { client, calls } = fakeAdmin({});
    expect(await portalAssignmentDeps(client, { ...job, customerId: null }).accountManager()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('länet frågas med arbetsplatsens postnummer och ort', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ address: { 'ISO3166-2-lvl4': 'SE-X' } }])));
    const { client } = fakeAdmin({});
    expect(await portalAssignmentDeps(client, job, { fetchImpl: fetchImpl as never }).county()).toBe('Gävleborg');
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain('postalcode=806+28&city=G%C3%A4vle');
  });

  it('ett databasfel kastas', async () => {
    const { client } = fakeAdmin({ crm_portal_resellers: { data: null, error: { message: 'nere' } } });
    await expect(portalAssignmentDeps(client, job).resellerSeller()).rejects.toThrow(/Fördelningen: nere/);
  });

  it('länsregeln: rätt län, och ett databasfel kastas i stället för att hoppa till reserven', async () => {
    const ok = fakeAdmin({ crm_routing_rules: { data: { user_id: 'county-user' } } });
    expect(await portalAssignmentDeps(ok.client, job).countyUser('Gävleborg')).toBe('county-user');
    expect(ok.calls[0]).toMatchObject({ table: 'crm_routing_rules', filters: [['county', 'Gävleborg']] });

    const failing = fakeAdmin({ crm_routing_rules: { data: null, error: { message: 'timeout' } } });
    await expect(portalAssignmentDeps(failing.client, job).countyUser('Gävleborg')).rejects.toThrow(/Fördelningen: timeout/);
  });
});
