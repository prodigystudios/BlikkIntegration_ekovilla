import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONSTRUCTIONS,
  CONSTRUCTION_SLUGS,
  CONSTRUCTION_VALUES_WITH_EMPTY,
  constructionLabel,
  inferConstructionFromArticle,
} from '@/lib/domains/crm/constructions';

// Konstruktionsvokabulären stod skriven på sex ställen i tre lager innan den samlades här, och de
// felade olika: en missad etikettkarta trycker en rå slug på egenkontrollen KUNDEN FÅR I HANDEN,
// ett missat Zod-enum får raden att tyst tappa sin placering (fältet är .default('')), en missad
// TS-union fångas gratis av kompilatorn. Testerna nedan låser de två som INTE fångas gratis —
// etiketterna och databasens CHECK — plus gissningsfunktionens ordning.

describe('konstruktionsvokabulären', () => {
  it('fem värden, i samma ordning som databasens CHECK', () => {
    expect(CONSTRUCTION_SLUGS).toEqual(['vagg', 'snedtak', 'vind', 'golv', 'mellanbjalklag']);
  });

  it('varje slug har en svensk etikett — ingen renderas rå', () => {
    expect(CONSTRUCTIONS).toEqual([
      { slug: 'vagg', label: 'Vägg' },
      { slug: 'snedtak', label: 'Snedtak' },
      { slug: 'vind', label: 'Vind' },
      { slug: 'golv', label: 'Golv' },
      { slug: 'mellanbjalklag', label: 'Mellanbjälklag' },
    ]);
    for (const { label } of CONSTRUCTIONS) {
      expect(CONSTRUCTION_SLUGS).not.toContain(label);
    }
  });

  it('constructionLabel: okänt, tomt och null ger tomma strängen — anropsstället äger reserven', () => {
    expect(constructionLabel('vind')).toBe('Vind');
    expect(constructionLabel('mellanbjalklag')).toBe('Mellanbjälklag');
    expect(constructionLabel('')).toBe('');
    expect(constructionLabel(null)).toBe('');
    expect(constructionLabel(undefined)).toBe('');
    expect(constructionLabel('takstol')).toBe('');
  });

  it('CONSTRUCTION_VALUES_WITH_EMPTY = vokabulären + tomma strängen (offertradens "inte satt")', () => {
    expect(CONSTRUCTION_VALUES_WITH_EMPTY).toEqual([...CONSTRUCTION_SLUGS, '']);
  });
});

describe('inferConstructionFromArticle', () => {
  it('bevarar de tre mönster som varit i drift', () => {
    expect(inferConstructionFromArticle('EKOVILLA cellulosa snedtak')).toBe('snedtak');
    expect(inferConstructionFromArticle('Isolering sned tak 300 mm')).toBe('snedtak');
    expect(inferConstructionFromArticle('Lösull taklutning')).toBe('snedtak');
    expect(inferConstructionFromArticle('PAROC SHT 1, Lösull vind')).toBe('vind');
    expect(inferConstructionFromArticle('Isolering vinden')).toBe('vind');
    expect(inferConstructionFromArticle('EKOVILLA cellulosa vägg')).toBe('vagg');
    expect(inferConstructionFromArticle('Lösull regelstomme')).toBe('vagg');
  });

  it('känner igen de två nya värdena', () => {
    expect(inferConstructionFromArticle('Lösull mellanbjälklag 200 mm')).toBe('mellanbjalklag');
    expect(inferConstructionFromArticle('Losull mellanbjalklag')).toBe('mellanbjalklag');
    expect(inferConstructionFromArticle('Ekovilla golv')).toBe('golv');
    expect(inferConstructionFromArticle('Isolering golvbjälklag')).toBe('golv');
  });

  // ⚠️ Vind-grenen matchar `vinds?bjälklag` och ligger FÖRE bjälklagsmönstren. Byts ordningen
  // hamnar vindsisolering i ett mellanbjälklag, och felet syns aldrig hos oss — bara som fel hink
  // i säckrapporteringens differens, långt senare.
  it('ORDNING: vindsbjälklag är vind, inte ett bjälklag', () => {
    expect(inferConstructionFromArticle('Lösull vindsbjälklag')).toBe('vind');
    expect(inferConstructionFromArticle('Lösull vindbjälklag')).toBe('vind');
  });

  it('ORDNING: mellanbjälklag vinner över golv när båda orden står i namnet', () => {
    expect(inferConstructionFromArticle('Lösull mellanbjälklag/golv')).toBe('mellanbjalklag');
  });

  // ⚠️ Regeln som ALDRIG får luckras upp: ett bart "bjälklag" är tvetydigt (vinds-, mellan- eller
  // golvbjälklag) och rätt svar är ospecificerat, inte en gissning.
  it('bart "bjälklag" gissas INTE', () => {
    expect(inferConstructionFromArticle('Lösull bjälklag 200 mm')).toBe('');
  });

  it('inget mönster → tomt, vilket är ett giltigt tillstånd', () => {
    expect(inferConstructionFromArticle('Ekovilla Cellulosa Lösull CE ETA-09/0081')).toBe('');
    expect(inferConstructionFromArticle('')).toBe('');
    expect(inferConstructionFromArticle(null)).toBe('');
    expect(inferConstructionFromArticle(undefined)).toBe('');
  });
});

// ⚠️ Databasen har en kopia av vokabulären som typsystemet inte når: CHECK:en på
// ops_segment_reports.construction. Glider de isär avvisar databasen ett värde resten av appen
// anser giltigt — mitt i installatörens sparning, där felet är som dyrast.
describe('paritet med databasens CHECK', () => {
  it('ops_segment_reports_construction_chk listar exakt CONSTRUCTION_SLUGS', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/sql/20260820_ops_segment_reports_sack_reporting.sql'),
      'utf8',
    );
    const match = sql.match(/ops_segment_reports_construction_chk[\s\S]*?check \(construction is null or construction in \(([^)]*)\)\)/);
    expect(match, 'hittade inte CHECK:en i migreringsfilen').not.toBeNull();
    const slugsInSql = match![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    expect(slugsInSql).toEqual([...CONSTRUCTION_SLUGS]);
  });
});
