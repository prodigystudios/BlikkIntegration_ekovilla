import { describe, expect, it } from 'vitest';
import { filterLinks, toEffectiveRole } from '@/lib/roles';
import type { UserRole } from '@/lib/roles';

describe('toEffectiveRole', () => {
  // Regeln stod i fem kopior innan den samlades här, och den styr BÅDE sidomenyn och CRM-grinden
  // (app/crm/layout.tsx släpper in den som mappas till sales). En felaktig mappning är därför inte
  // ett kosmetiskt fel utan en öppen dörr till hela kundregistret.
  it('läser konsult som sales — och ingen annan roll', () => {
    expect(toEffectiveRole('konsult')).toBe('sales');
    for (const role of ['member', 'sales', 'admin', 'ekonomi'] as UserRole[]) {
      expect(toEffectiveRole(role)).toBe(role);
    }
  });

  it('svarar null på null och undefined', () => {
    expect(toEffectiveRole(null)).toBeNull();
    expect(toEffectiveRole(undefined)).toBeNull();
  });

  // ⚠️ DEN HÄR RADEN ÄR HELA POÄNGEN MED ATT ekonomi ÄR EN EGEN ROLL.
  //
  // Lönebyrån är extern. Hade hon fått rollen `konsult` — den befintliga externa rollen — hade
  // mappningen ovan gjort henne till sales, och CRM-grinden hade släppt in henne i kundregistret,
  // priserna och offerterna. Att `ekonomi` går igenom orörd är alltså inte en detalj i en
  // hjälpfunktion; det är det som håller henne utanför CRM:et.
  it('mappar INTE ekonomi till sales — det hade gett lönebyrån hela CRM:et', () => {
    expect(toEffectiveRole('ekonomi')).not.toBe('sales');
  });
});

describe('filterLinks', () => {
  it('ger ekonomi inga CRM-länkar', () => {
    const hrefs = filterLinks('ekonomi').map((link) => link.href);
    for (const forbidden of ['/crm', '/crm/dokument', '/crm/korjournal', '/crm/planering', '/plannering', '/mina-jobb', '/tidrapport']) {
      expect(hrefs).not.toContain(forbidden);
    }
  });
});
