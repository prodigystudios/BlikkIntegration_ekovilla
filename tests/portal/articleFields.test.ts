import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  formatLaborSharePercent,
  hasAtMostThreeDecimals,
  isValidPortalArticleNumber,
  parseLaborSharePercent,
  portalPublishBlockers,
  toPortalArticleFields,
} from '@/lib/domains/portal/articleFields';
import {
  portalArticleFieldsInputSchema,
  savePortalArticleFields,
  type PortalArticleFieldsInput,
} from '@/lib/domains/portal/articleFieldsStore';

/**
 * Portalfälten per artikel (RESELLER_PORTAL_CRM_PLAN.md fas 2a). Det som skyddas:
 *   - arbetsandelen ger ROT i portalen och lagras som numeric(4,3): en fjärde decimal avrundas TYST i databasen, så
 *     den nekas här, och procenttexten ("45,5") blir exakt andelen (0,455) utan flyttalsbrus;
 *   - en publicerad artikel har kundnamn och kategori (portalens kolumner är not null);
 *   - vad publiceringen hoppar över: inaktiv, utan enhet, utan pris på lista 160. 0 kr är ett pris;
 *   - sparandet läser tillbaka raden: en UPDATE som RLS stoppar ger inget fel, bara noll rader.
 */

const VALID: PortalArticleFieldsInput = {
  customer_name: 'Lösull på vinden',
  category: 'losull',
  labor_share: 0.45,
  note: '',
  sort_order: 10,
  publish: true,
};

describe('parseLaborSharePercent', () => {
  it.each([
    ['45', 0.45],
    ['45,5', 0.455],
    ['45.5', 0.455],
    [' 45 % ', 0.45],
    ['45%', 0.45],
    ['0', 0],
    ['100', 1],
    ['100,0', 1],
    ['0,1', 0.001],
  ])('"%s" → %s', (text, share) => {
    expect(parseLaborSharePercent(text)).toBe(share);
  });

  it.each(['', '  ', '45,55', '100,1', '101', '-5', 'abc', '1e2', '45,', ',5', '4 5'])('"%s" → null', (text) => {
    expect(parseLaborSharePercent(text)).toBeNull();
  });

  it('varje tiondels procent 0–100 går fram och tillbaka exakt, och klarar databasens tre decimaler', () => {
    for (let tenths = 0; tenths <= 1000; tenths += 1) {
      const share = tenths / 1000;
      const text = formatLaborSharePercent(share);
      expect(parseLaborSharePercent(text), text).toBe(share);
      expect(hasAtMostThreeDecimals(share), text).toBe(true);
    }
  });
});

describe('formatLaborSharePercent', () => {
  it.each([
    [0.45, '45'],
    [0.5, '50'],
    [0.455, '45,5'],
    [0, '0'],
    [1, '100'],
    [0.001, '0,1'],
    // numeric kan komma som sträng och bli ett tal med brus.
    [0.30000000000000004, '30'],
  ])('%s → "%s"', (share, text) => {
    expect(formatLaborSharePercent(share)).toBe(text);
  });
});

describe('hasAtMostThreeDecimals', () => {
  it('godtar tre decimaler, också med flyttalsbrus', () => {
    expect(hasAtMostThreeDecimals(0.455)).toBe(true);
    expect(hasAtMostThreeDecimals(0.07)).toBe(true); // 0.07 * 1000 = 70.00000000000001
    expect(hasAtMostThreeDecimals(0.1 + 0.2)).toBe(true);
  });

  it('nekar en fjärde decimal, som databasen annars hade avrundat tyst', () => {
    expect(hasAtMostThreeDecimals(0.4555)).toBe(false);
    expect(hasAtMostThreeDecimals(0.0001)).toBe(false);
  });
});

describe('portalArticleFieldsInputSchema', () => {
  it('godtar en publicerad artikel med allt ifyllt, och trimmar texterna', () => {
    const parsed = portalArticleFieldsInputSchema.parse({ ...VALID, customer_name: '  Lösull på vinden ', note: ' Inblåst ' });
    expect(parsed.customer_name).toBe('Lösull på vinden');
    expect(parsed.note).toBe('Inblåst');
  });

  it('en publicerad artikel kräver kundnamn och kategori', () => {
    const noName = portalArticleFieldsInputSchema.safeParse({ ...VALID, customer_name: '   ' });
    expect(noName.success).toBe(false);
    expect(noName.error?.flatten().fieldErrors.customer_name?.[0]).toMatch(/kundnamnet/);

    const noCategory = portalArticleFieldsInputSchema.safeParse({ ...VALID, category: null });
    expect(noCategory.success).toBe(false);
    expect(noCategory.error?.flatten().fieldErrors.category?.[0]).toMatch(/kategori/);
  });

  it('en opublicerad artikel får sakna kundnamn och kategori', () => {
    expect(portalArticleFieldsInputSchema.safeParse({ ...VALID, publish: false, customer_name: '', category: null }).success).toBe(true);
  });

  it.each([
    ['arbetsandel över 1', { labor_share: 1.001 }],
    ['negativ arbetsandel', { labor_share: -0.001 }],
    ['arbetsandel med fyra decimaler', { labor_share: 0.4555 }],
    ['okänd kategori', { category: 'fel' }],
    ['ordning som inte är ett heltal', { sort_order: 1.5 }],
    ['negativ ordning', { sort_order: -1 }],
    ['för långt kundnamn', { customer_name: 'x'.repeat(201) }],
    ['för lång anteckning', { note: 'x'.repeat(501) }],
    ['publish som text', { publish: 'true' }],
    ['arbetsandel som text', { labor_share: '0,45' }],
  ])('nekar %s', (_label, patch) => {
    expect(portalArticleFieldsInputSchema.safeParse({ ...VALID, ...patch }).success).toBe(false);
  });

  it('godtar gränserna', () => {
    for (const patch of [{ labor_share: 0 }, { labor_share: 1 }, { sort_order: 0 }, { customer_name: 'x'.repeat(200) }, { note: 'x'.repeat(500) }]) {
      expect(portalArticleFieldsInputSchema.safeParse({ ...VALID, ...patch }).success, JSON.stringify(patch)).toBe(true);
    }
  });
});

describe('isValidPortalArticleNumber', () => {
  it('samma regel som migreringens check', () => {
    expect(isValidPortalArticleNumber('2410509')).toBe(true);
    expect(isValidPortalArticleNumber('4WCBTD60')).toBe(true);
    expect(isValidPortalArticleNumber('x'.repeat(50))).toBe(true);
    expect(isValidPortalArticleNumber('')).toBe(false);
    expect(isValidPortalArticleNumber(' 2410509')).toBe(false);
    expect(isValidPortalArticleNumber('2410509 ')).toBe(false);
    expect(isValidPortalArticleNumber('x'.repeat(51))).toBe(false);
  });
});

describe('portalPublishBlockers', () => {
  const OK = { active: true, unit: 'm3', resellerPrice: 342 };

  it('ingenting stoppar en aktiv artikel med enhet och pris', () => {
    expect(portalPublishBlockers(OK)).toEqual([]);
  });

  it('0 kr är ett pris, inte ett saknat pris', () => {
    expect(portalPublishBlockers({ ...OK, resellerPrice: 0 })).toEqual([]);
  });

  it('inaktiv, utan enhet och utan pris stoppar var för sig', () => {
    expect(portalPublishBlockers({ ...OK, active: false })).toEqual(['inactive']);
    expect(portalPublishBlockers({ ...OK, unit: null })).toEqual(['missing_unit']);
    expect(portalPublishBlockers({ ...OK, unit: '   ' })).toEqual(['missing_unit']);
    expect(portalPublishBlockers({ ...OK, resellerPrice: null })).toEqual(['missing_price']);
    expect(portalPublishBlockers({ ...OK, resellerPrice: Number.NaN })).toEqual(['missing_price']);
  });

  it('flera på en gång, i fast ordning', () => {
    expect(portalPublishBlockers({ active: false, unit: '', resellerPrice: null })).toEqual([
      'inactive',
      'missing_unit',
      'missing_price',
    ]);
  });
});

describe('toPortalArticleFields', () => {
  it('numeric som sträng blir ett tal', () => {
    const fields = toPortalArticleFields({
      article_number: '2410509',
      customer_name: 'Lösull på vinden',
      category: 'losull',
      labor_share: '0.450',
      note: '',
      sort_order: 10,
      publish: true,
      updated_at: '2026-09-28T06:44:37Z',
    });
    expect(fields.labor_share).toBe(0.45);
    expect(fields.category).toBe('losull');
    expect(fields.publish).toBe(true);
  });

  it('en okänd kategori blir null, och saknade fält får sina standardvärden', () => {
    const fields = toPortalArticleFields({ article_number: '1', category: 'fel' });
    expect(fields).toEqual({
      article_number: '1',
      customer_name: '',
      category: null,
      labor_share: 0,
      note: '',
      sort_order: 0,
      publish: false,
      updated_at: null,
    });
  });
});

describe('savePortalArticleFields', () => {
  function client(result: { data: unknown; error: unknown }) {
    const chain = {
      upsert: vi.fn(() => chain),
      select: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => result),
    };
    const from = vi.fn(() => chain);
    return { supabase: { from } as unknown as SupabaseClient, from, chain };
  }

  it('upserter på artikelnumret med den inloggades id och ger tillbaka raden som den blev', async () => {
    const row = { article_number: '2410509', ...VALID, labor_share: '0.450', updated_at: '2026-09-28T06:44:37Z' };
    const { supabase, from, chain } = client({ data: row, error: null });

    const outcome = await savePortalArticleFields(supabase, '2410509', VALID, 'user-admin-1');

    expect(from).toHaveBeenCalledWith('crm_portal_article_fields');
    expect(chain.upsert).toHaveBeenCalledWith(
      { article_number: '2410509', ...VALID, updated_by: 'user-admin-1' },
      { onConflict: 'article_number' },
    );
    expect(outcome).toEqual({ kind: 'saved', fields: { ...row, labor_share: 0.45 } });
  });

  it('ingen rad tillbaka = stoppad av RLS, inte sparad', async () => {
    const { supabase } = client({ data: null, error: null });
    expect(await savePortalArticleFields(supabase, '2410509', VALID, 'u')).toEqual({ kind: 'forbidden' });
  });

  it('42501 är forbidden, 23514 är en regel i databasen, annat är ett databasfel', async () => {
    expect(await savePortalArticleFields(client({ data: null, error: { code: '42501', message: 'rls' } }).supabase, '1', VALID, 'u'))
      .toEqual({ kind: 'forbidden' });
    expect((await savePortalArticleFields(client({ data: null, error: { code: '23514', message: 'check' } }).supabase, '1', VALID, 'u')).kind)
      .toBe('invalid');
    expect(await savePortalArticleFields(client({ data: null, error: { code: 'XX000', message: 'boom' } }).supabase, '1', VALID, 'u'))
      .toEqual({ kind: 'db_error', message: 'boom' });
  });
});

describe('webbläsarens del', () => {
  // Artikelsidans kort importerar den rena modulen. zod (och databasklienten) hade följt med till webbläsaren:
  // uppmätt +17 kB på redigeringssidan och sidan Ny artikel, som delar formuläret.
  it('den rena modulen och kortet importerar varken zod eller databasdelen', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['lib/domains/portal/articleFields.ts', 'app/crm/installningar/artiklar/PortalArticleFieldsCard.tsx']) {
      const source = readFileSync(file, 'utf8');
      // Varje importform: `from '…'`, `import '…'` och `import('…')`.
      const imports = [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      // Kortet har importer; hittar mönstret inga där har det slutat fungera och testet är tomt.
      if (file.endsWith('.tsx')) expect(imports, file).toContain('@/lib/domains/portal/articleFields');
      expect(imports.filter((i) => i === 'zod' || i.startsWith('@supabase/') || i.includes('articleFieldsStore')), file).toEqual([]);
    }
  });
});
