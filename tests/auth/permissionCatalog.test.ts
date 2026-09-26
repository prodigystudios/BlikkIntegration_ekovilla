import { describe, it, expect } from 'vitest';
import { PERMISSION_KEYS } from '@/lib/auth/permissions';
import { keysForRole, rolesWithKey, sqlCatalog } from '../helpers/permissionSeed';
import { getVisibleAppNavItems } from '@/app/_lib/appNav';
import type { UserRole } from '@/lib/roles';

/**
 * Katalogen finns på två ställen: SQL-tabellen `permissions` och PERMISSION_KEYS i koden. De måste vara
 * SAMMA mängd. En nyckel som bara finns i koden 403:ar alla (getEffectivePermissions failar closed); en
 * som bara finns i SQL går inte att använda i en grind utan att kompilatorn protesterar.
 *
 * SQL-sidan läses som PROD ser ut: prods export (supabase/seed/reference.sql) med varje migrering
 * pålagd — se tests/helpers/permissionSeed.ts.
 */

describe('behörighetskatalogen', () => {
  it('läser faktiskt SQL-katalogen — annars är testet tomt', () => {
    const keys = sqlCatalog();
    expect(keys.has('crm.access')).toBe(true); // ur seeden
    expect(keys.has('app.access')).toBe(true); // ur en migrering
  });

  it('SQL och koden har exakt samma nycklar', () => {
    expect([...sqlCatalog()].sort()).toEqual([...PERMISSION_KEYS].sort());
  });
});

/**
 * Menyn per roll, som den såg ut FÖRE bytet från roller till nycklar (fryst ur den rollstyrda
 * getVisibleAppNavItems 2026-09-26). Med sina seedade nycklar ska varje roll se EXAKT samma meny —
 * samma rader, samma grupper, samma ihopfällningar. Det är beviset att bytet inte flyttade en enda rad.
 *
 * 🧨 Nycklarnas seed följer regeln `roles ∪ {konsult om sales}`: menyn gjorde konsult till sales
 * INNAN den filtrerade, så 'konsult' stod inte i en enda `roles`-lista. Tappar seeden konsult syns det
 * här som en saknad rad för konsult.
 *
 * Ändras menyn MED FLIT (en rad läggs till eller flyttas) uppdateras listan här i samma ändring.
 */
type MenuShape = (string | Record<string, string[]>)[];
const MENU_BEFORE_KEYS: Record<UserRole, MenuShape> = {
  member: ['/', '/mina-jobb', {'group:egenkontroll': ['/egenkontroll', '/archive']}, '/tid', {'group:dokument': ['/mina-dokument', '/dokument-information']}, {'group:ovrigt': ['/kontakt-lista', '/nyheter', '/material-kvalitet', '/bestallning-klader', '/felanmalan']}],
  sales: ['/', '/crm', '/crm/planering', '/plannering', '/crm/korjournal', '/archive', {'group:dokument': ['/mina-dokument', '/crm/dokument', '/dokument-information']}, {'group:ovrigt': ['/kontakt-lista', '/nyheter', '/material-kvalitet', '/felanmalan']}],
  admin: ['/', '/crm', '/crm/planering', '/plannering', '/crm/korjournal', '/mina-jobb', {'group:egenkontroll': ['/egenkontroll', '/archive']}, '/tid', {'group:dokument': ['/mina-dokument', '/crm/dokument', '/dokument-information']}, {'group:ovrigt': ['/kontakt-lista', '/nyheter', '/material-kvalitet', '/bestallning-klader', '/felanmalan']}, '/ekonomi', '/admin'],
  konsult: ['/', '/crm', '/crm/planering', '/plannering', '/crm/korjournal', '/archive', {'group:dokument': ['/mina-dokument', '/crm/dokument', '/dokument-information']}, {'group:ovrigt': ['/kontakt-lista', '/nyheter', '/material-kvalitet', '/felanmalan']}],
  ekonomi: ['/ekonomi', '/ekonomi/arbetsorder'],
};

function menuShape(role: UserRole): MenuShape {
  const keys = keysForRole(role);
  return getVisibleAppNavItems(role, (key) => keys.has(key)).map((item) =>
    item.children ? { [item.href]: item.children.map((c) => c.href) } : item.href,
  );
}

describe('menyn med nycklar = menyn före bytet', () => {
  it.each(Object.keys(MENU_BEFORE_KEYS) as UserRole[])('%s', (role) => {
    expect(menuShape(role)).toEqual(MENU_BEFORE_KEYS[role]);
  });

  // Utloggad / okänd roll / läsningen misslyckades: inga nycklar. Menyn får aldrig bli tom — Start
  // har ingen grind med flit. (Före bytet såg `null` även tre ospärrade rader; de gatas nu på nycklar.)
  it('utan nycklar och roll finns Start kvar', () => {
    expect(getVisibleAppNavItems(null, () => false).map((i) => i.href)).toEqual(['/']);
  });
});

describe('appnycklarnas seed', () => {
  it('ger aldrig lönebyrån (ekonomi) en appnyckel', () => {
    for (const key of PERMISSION_KEYS.filter((k) => k.startsWith('app.'))) {
      expect(rolesWithKey(key), key).not.toContain('ekonomi');
    }
  });

  // /crm/installningar och /crm/installningar/kalkyl krävde role = 'admin'.
  it('crm.settings.manage är bara admin', () => {
    expect(rolesWithKey('crm.settings.manage')).toEqual(['admin']);
  });

  // Intern personal — ersätter isReadonlyRole (konsult, ekonomi = externa).
  it('app.staff är member, sales och admin — aldrig en extern roll', () => {
    expect(rolesWithKey('app.staff')).toEqual(['admin', 'member', 'sales']);
  });

  // ⚠️ Lönebyrån är extern och hålls UTANFÖR CRM:et av att hon saknar crm.access (hela /crm gatas på
  // den). Förr bar toEffectiveRole den vakten — att `ekonomi` inte mappades till sales. Nu är det seeden.
  it('lönebyrån (ekonomi) har aldrig crm.access', () => {
    expect(rolesWithKey('crm.access')).not.toContain('ekonomi');
  });
});
