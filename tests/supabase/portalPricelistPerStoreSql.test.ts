import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pricelistIdempotencyKey } from '@/lib/domains/portal/pricelist';
import { RESELLER_ID_PATTERN } from '@/lib/domains/portal/resellers';

/**
 * Prislistorna per butik (20261001102248_portal_pricelist_per_store.sql, RESELLER_PORTAL_CRM_PLAN.md 10b2). Reglerna bor
 * i SQL som typsystemet inte når, så testet läser filen:
 *   - nyckelns form i databasen är den koden bygger, för den gemensamma listan och för en butiks;
 *   - butikens id följer samma mönster som crm_portal_resellers;
 *   - migreringen är additiv: inga borttagna kolumner, inga grants eller revokes.
 */

const RAW = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261001102248_portal_pricelist_per_store.sql'), 'utf8');
const sql = RAW.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();

describe('prislistorna per butik (SQL)', () => {
  const hash = 'f'.repeat(64);
  const check = RAW.match(/idempotency_key ~ '([^']+)'/);

  it('nyckelns mönster godtar den gemensamma listans nyckel och en butiks, och inget annat format', () => {
    expect(check).not.toBeNull();
    const pattern = new RegExp(check![1]);
    expect(pattern.test(pricelistIdempotencyKey('2026-10-01', hash, 7))).toBe(true);
    expect(pattern.test(pricelistIdempotencyKey('2026-10-01', hash, 7, '6f1c2a9e-4b7d-4f0e-9a51-0c3d2e8b7a64'))).toBe(true);
    expect(pattern.test(pricelistIdempotencyKey('2026-10-01', hash, 7, 'res-norrbygg'))).toBe(true);
    expect(pattern.test(`pricelist-2026-10-01-${hash}-0`)).toBe(false);
    expect(pattern.test(`pricelist-2026-10-01-${hash}-7-`)).toBe(false);
  });

  it('nyckeln binder datumet, hashen, löpnumret och butiken till raden', () => {
    expect(sql).toContain(
      "idempotency_key = 'pricelist-' || substring(idempotency_key from 11 for 10) || '-' || content_hash || '-' || sequence::text || coalesce('-' || reseller_id, '')",
    );
    // Samma uttryck i JS.
    const key = pricelistIdempotencyKey('2026-10-01', hash, 7, 'res-a');
    expect(`pricelist-${key.substring(10, 20)}-${hash}-7${'-res-a'}`).toBe(key);
    expect(`pricelist-${key.substring(10, 20)}-${hash}-7`).toBe(pricelistIdempotencyKey('2026-10-01', hash, 7));
  });

  it('butikens id följer samma mönster som crm_portal_resellers', () => {
    expect(RAW).toContain("reseller_id is null or reseller_id ~ '^(?!\\.+$)[A-Za-z0-9._~-]{1,100}$'");
    expect(RESELLER_ID_PATTERN.source).toBe('^(?!\\.+$)[A-Za-z0-9._~-]{1,100}$');
  });

  it('additiv: kolumnerna läggs till och får vara null, och inga grants ändras', () => {
    expect(sql).toContain('add column if not exists reseller_id text;');
    expect(sql).toContain('add column if not exists price_list_code text;');
    expect(sql).not.toMatch(/drop column|\bgrant\b|\brevoke\b|set not null/);
  });

  it('inga astrala tecken i filen', () => {
    expect([...RAW].filter((c) => c.codePointAt(0)! > 0xffff)).toEqual([]);
  });
});
