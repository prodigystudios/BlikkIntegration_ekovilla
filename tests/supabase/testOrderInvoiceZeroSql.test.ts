import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Engångsrättningen av testordern AO-20260819-9B8DD9 (20261020101042_avbryt_testorder_fakturanummer_noll.sql).
 *
 * Satsen sätter en order till Avbruten och tömmer dess fakturanummer. Det enda som hindrar den från att göra
 * samma sak med riktiga, fakturerade ordrar är WHERE-satsen — tappas ett villkor (en kopia "för en annan order")
 * avbryts fakturerade ordrar i klump och deras fakturanummer försvinner. Testet låser villkoren och efterkontrollen.
 * Beteendet prövades mot den lokala databasen i en återrullad transaktion (2026-10-20).
 */

const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261020101042_avbryt_testorder_fakturanummer_noll.sql'), 'utf8')
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const update = SQL.match(/update public\.crm_work_orders wo set (.*?);/)?.[1] ?? '';
// Allt efter FÖRSTA where — underfrågan har ett eget.
const where = update.includes(' where ') ? update.slice(update.indexOf(' where ') + 7) : '';

describe('testordern AO-20260819-9B8DD9 (SQL)', () => {
  it('hittar UPDATE-satsen — annars är testet tomt', () => {
    expect(where).not.toBe('');
  });

  it('träffar bara den ordern, bara Avslutad och bara med fakturanumret "0"', () => {
    expect(where).toContain("wo.order_number = 'ao-20260819-9b8dd9'");
    expect(where).toContain("wo.status = 'invoiced'");
    expect(where).toContain("wo.fortnox_invoice_number ~ '^\\s*0+\\s*$'");
    expect(SQL.match(/update public\./g)).toHaveLength(1);
  });

  // Villkoren måste ALLA gälla. Ett `or` någonstans (utanför underfrågan) hade öppnat satsen för varje rad.
  it('villkoren binds bara ihop med and', () => {
    expect(where.replace(/\(select .*?\)/g, '')).not.toMatch(/\bor\b/);
  });

  it('avbryter inte en order vars fakturering börjat', () => {
    expect(where).toContain('wo.partial_invoicing_started_at is null');
    expect(where).toContain('not exists (select 1 from public.crm_work_order_invoices i where i.work_order_id = wo.id)');
  });

  it('säger ifrån när ordern fortfarande bär "0" efteråt', () => {
    expect(SQL).toMatch(/do \$\$ begin if exists \( select 1 from public\.crm_work_orders where order_number = 'ao-20260819-9b8dd9' and fortnox_invoice_number ~ '\^\\s\*0\+\\s\*\$' \) then raise exception/);
  });
});
