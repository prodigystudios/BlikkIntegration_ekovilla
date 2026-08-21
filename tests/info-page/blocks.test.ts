import { describe, expect, it } from 'vitest';
import {
  normalizeBlocks,
  normalizeHref,
  MAX_BLOCKS,
} from '@/lib/domains/info-page/blocks';

describe('normalizeHref', () => {
  it('släpper igenom de fyra scheman en informationssida behöver', () => {
    expect(normalizeHref('https://ekovilla.se')).toBe('https://ekovilla.se');
    expect(normalizeHref('http://intranat.local/sida')).toBe('http://intranat.local/sida');
    expect(normalizeHref('tel:0841063700')).toBe('tel:0841063700');
    expect(normalizeHref('mailto:skydd@ekovilla.se')).toBe('mailto:skydd@ekovilla.se');
  });

  it('kastar scheman som kör kod eller bär innehåll', () => {
    expect(normalizeHref('javascript:alert(1)')).toBeNull();
    expect(normalizeHref('JavaScript:alert(1)')).toBeNull();
    expect(normalizeHref('  javascript:alert(1)')).toBeNull();
    expect(normalizeHref('vbscript:msgbox(1)')).toBeNull();
    expect(normalizeHref('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(normalizeHref('file:///etc/passwd')).toBeNull();
  });

  it('kastar scheman som gömmer sig bakom kontrolltecken', () => {
    // Webbläsaren struntar i tab och nyrad inuti ett schemanamn, så en prefixkontroll som
    // inte städar först släpper igenom exakt det här.
    expect(normalizeHref('java\tscript:alert(1)')).toBeNull();
    expect(normalizeHref('java\nscript:alert(1)')).toBeNull();
    expect(normalizeHref('java\u0000script:alert(1)')).toBeNull();
    expect(normalizeHref('jav\u000Bascript:alert(1)')).toBeNull();
  });

  it('kastar protokollrelativa adresser', () => {
    // //exempel.se ärver sidans schema och pekar ut ur appen utan att se ut som en adress.
    expect(normalizeHref('//exempel.se')).toBeNull();
  });

  it('behåller interna vägar', () => {
    expect(normalizeHref('/felanmalan')).toBe('/felanmalan');
  });

  it('gissar rätt när schemat saknas', () => {
    expect(normalizeHref('08-410 637 00')).toBe('tel:0841063700');
    expect(normalizeHref('+46 8 410 637 00')).toBe('tel:+46841063700');
    expect(normalizeHref('skydd@ekovilla.se')).toBe('mailto:skydd@ekovilla.se');
    expect(normalizeHref('www.ekovilla.se')).toBe('https://www.ekovilla.se');
  });

  it('avvisar det som inte är en sträng', () => {
    expect(normalizeHref(null)).toBeNull();
    expect(normalizeHref(undefined)).toBeNull();
    expect(normalizeHref(42)).toBeNull();
    expect(normalizeHref('')).toBeNull();
    expect(normalizeHref('   ')).toBeNull();
  });
});

describe('normalizeBlocks', () => {
  it('kastar allt som inte är en känd blocktyp', () => {
    const raw = [
      { type: 'script', children: [{ type: 'text', text: 'nej' }] },
      { type: 'html', value: '<img onerror=alert(1)>' },
      'en lös sträng',
      null,
      42,
      { children: [{ type: 'text', text: 'utan typ' }] },
    ];
    expect(normalizeBlocks(raw)).toEqual([]);
  });

  it('kastar inline-noder som inte är text eller länk', () => {
    const raw = [{
      type: 'paragraph',
      children: [
        { type: 'text', text: 'behålls' },
        { type: 'image', src: 'x' },
        { type: 'script', text: 'nej' },
      ],
    }];
    expect(normalizeBlocks(raw)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'behålls' }] },
    ]);
  });

  it('låter en länk med osäker adress falla tillbaka på sin text', () => {
    // Texten är innehåll och ska överleva; adressen är bara hur den nås.
    const raw = [{
      type: 'paragraph',
      children: [{ type: 'link', href: 'javascript:alert(1)', text: 'Klicka här', bold: true }],
    }];
    expect(normalizeBlocks(raw)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'Klicka här', bold: true }] },
    ]);
  });

  it('behåller fetstil bara när den är exakt true', () => {
    const raw = [{
      type: 'paragraph',
      children: [
        { type: 'text', text: 'a', bold: true },
        { type: 'text', text: 'b', bold: 'ja' },
        { type: 'text', text: 'c', bold: 1 },
      ],
    }];
    // b och c slås ihop med varandra men inte med a, som är fet.
    expect(normalizeBlocks(raw)).toEqual([
      { type: 'paragraph', children: [
        { type: 'text', text: 'a', bold: true },
        { type: 'text', text: 'bc' },
      ] },
    ]);
  });

  it('slår ihop grannar med samma formatering', () => {
    // contentEditable delar gärna en mening i flera textnoder när man klickar runt i den.
    // Utan sammanslagningen växer body:n varje gång någon öppnar och sparar utan att ändra.
    const raw = [{
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Det ' },
        { type: 'text', text: 'skall ' },
        { type: 'text', text: 'finnas' },
        { type: 'text', text: ' ett sele-kit', bold: true },
      ],
    }];
    expect(normalizeBlocks(raw)).toEqual([
      { type: 'paragraph', children: [
        { type: 'text', text: 'Det skall finnas' },
        { type: 'text', text: ' ett sele-kit', bold: true },
      ] },
    ]);
  });

  it('kastar tomma stycken och tomma listposter', () => {
    const raw = [
      { type: 'paragraph', children: [] },
      { type: 'paragraph', children: [{ type: 'text', text: '   ' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'kvar' }] },
      { type: 'list', ordered: false, items: [[], [{ type: 'text', text: '  ' }], [{ type: 'text', text: 'punkt' }]] },
      { type: 'list', ordered: false, items: [] },
    ];
    expect(normalizeBlocks(raw)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'kvar' }] },
      { type: 'list', ordered: false, items: [[{ type: 'text', text: 'punkt' }]] },
    ]);
  });

  it('behandlar ordered som falskt om det inte är exakt true', () => {
    const items = [[{ type: 'text', text: 'a' }]];
    expect(normalizeBlocks([{ type: 'list', items }])).toEqual([
      { type: 'list', ordered: false, items: [[{ type: 'text', text: 'a' }]] },
    ]);
    expect(normalizeBlocks([{ type: 'list', ordered: true, items }])[0]).toMatchObject({ ordered: true });
  });

  it('taket kapar i stället för att svälja en klistrad bok', () => {
    const many = Array.from({ length: MAX_BLOCKS + 50 }, (_, i) => ({
      type: 'paragraph',
      children: [{ type: 'text', text: `rad ${i}` }],
    }));
    expect(normalizeBlocks(many)).toHaveLength(MAX_BLOCKS);
  });

  it('svarar med en tom modell på skräp i stället för att kasta', () => {
    // Kolumnen är jsonb och kan innehålla vad som helst efter en handredigering i Supabase.
    // Sidan ska rendera tomt, inte krascha för alla.
    expect(normalizeBlocks(null)).toEqual([]);
    expect(normalizeBlocks('inte en array')).toEqual([]);
    expect(normalizeBlocks({ type: 'paragraph' })).toEqual([]);
    expect(normalizeBlocks(undefined)).toEqual([]);
  });

  it('är idempotent — en sparad modell överlever nästa sparning oförändrad', () => {
    const once = normalizeBlocks([
      { type: 'paragraph', children: [
        { type: 'text', text: 'Protector försäkring: ' },
        { type: 'link', href: 'tel:0841063700', text: '08-410 637 00', bold: true },
      ] },
      { type: 'list', ordered: false, items: [[{ type: 'text', text: 'Ett sele-kit per bil' }]] },
    ]);
    expect(normalizeBlocks(once)).toEqual(once);
  });
});

describe('normalizeHref — backslash-varianterna', () => {
  it('kastar /\\ som webbläsaren behandlar som protokollrelativ', () => {
    // Verifierat mot WHATWG-parsern: new URL('/\\evil.com', 'https://app.example.com/')
    // blir 'https://evil.com/'. Utan den här regeln passerade den som en INTERN väg, och
    // BlockContent satte då varken target eller rel=noopener på länken — den läste som en
    // länk inne i appen men navigerade bort.
    expect(normalizeHref('/\\evil.com')).toBeNull();
    expect(normalizeHref('\\\\evil.com')).toBeNull();
  });

  it('rör inte vanliga interna vägar', () => {
    expect(normalizeHref('/felanmalan')).toBe('/felanmalan');
    expect(normalizeHref('/documents/lathund.png')).toBe('/documents/lathund.png');
  });
});
