import { describe, expect, it } from 'vitest';
import { APP_NAV_ITEMS, getVisibleAppNavItems } from '@/app/_lib/appNav';
import type { UserRole } from '@/lib/roles';
import { keysForRole } from '../helpers/permissionSeed';

// Menyn gatas på nycklar (rader med `permission`) och roll (resten). Testerna frågar den som
// sidomenyn gör: med rollen OCH rollens seedade nycklar. `null` = okänd roll utan nycklar.
function nav(role: UserRole | null) {
  const keys = role ? keysForRole(role) : new Set<string>();
  return getVisibleAppNavItems(role, (key) => keys.has(key));
}

// `ekonomi` är med i svepet med flit: en ny roll är precis vad som kan tömma en grupp och få
// sidomenyn att rendera `href="group:…"` som en länk.
const ROLES: UserRole[] = ['member', 'sales', 'admin', 'ekonomi'];

function flatten(items: ReturnType<typeof nav>) {
  return items.flatMap((item) => (item.children ? item.children : [item]));
}

describe('getVisibleAppNavItems', () => {
  // Planeringssidan ligger bakom CRM-layoutens crm.access och läser data bakom planning.schedule.read.
  // En arbetsledare med bara planeringsnyckeln (personligt undantag) ska INTE få en rad som studsar.
  it('a row with several keys needs all of them', () => {
    const only = (...held: string[]) => (key: string) => held.includes(key);
    const hrefs = (can: (key: string) => boolean) =>
      flatten(getVisibleAppNavItems('member', can)).map((i) => i.href);
    expect(hrefs(only('planning.schedule.read'))).not.toContain('/crm/planering');
    expect(hrefs(only('crm.access'))).not.toContain('/crm/planering');
    expect(hrefs(only('crm.access', 'planning.schedule.read'))).toContain('/crm/planering');
  });

  // The sidebar renders a group as a <button> and only reaches the plain-link branch
  // when children is empty — at which point it would emit `href="group:…"`. Role gating
  // is the one thing that can empty a group, so the guard has to hold for every role.
  it('never returns a group without children', () => {
    for (const role of [...ROLES, null]) {
      for (const item of nav(role)) {
        if (item.children) expect(item.children.length).toBeGreaterThan(0);
      }
    }
  });

  it('only exposes real routes as destinations', () => {
    for (const role of ROLES) {
      for (const leaf of flatten(nav(role))) {
        expect(leaf.href.startsWith('/')).toBe(true);
      }
    }
  });

  it('gates children by role, not just top-level items', () => {
    const memberDocs = nav('member').find((i) => i.href === 'group:dokument');
    // Dokumentbibliotek is the CRM library — sales/admin only, and it sits inside a
    // group that members otherwise still see.
    expect(memberDocs?.children?.map((c) => c.href)).not.toContain('/crm/dokument');
    const salesDocs = nav('sales').find((i) => i.href === 'group:dokument');
    expect(salesDocs?.children?.map((c) => c.href)).toContain('/crm/dokument');
  });

  it('collapses a group down to its only visible child', () => {
    // Sales cannot create self-checks, only read the archive, so the Egenkontroll group
    // holds a single link for them — it should take the row itself rather than hide
    // behind a chevron.
    const sales = nav('sales');
    expect(sales.find((i) => i.href === 'group:egenkontroll')).toBeUndefined();
    const collapsed = sales.find((i) => i.href === '/archive');
    expect(collapsed?.label).toBe('Sparade egenkontroller');
    expect(collapsed?.children).toBeUndefined();

    // Members and admins see both, so the group stands.
    for (const role of ['member', 'admin'] as UserRole[]) {
      const group = nav(role).find((i) => i.href === 'group:egenkontroll');
      expect(group?.children?.map((c) => c.href)).toEqual(['/egenkontroll', '/archive']);
    }
  });

  it('keeps the offer calculator out of the menu while the surface is unused', () => {
    for (const role of [...ROLES, null]) {
      expect(flatten(nav(role)).map((i) => i.href)).not.toContain('/offert/kalkylator');
    }
  });

  // Cutovern 2026-09-01: raden "Tidrapport" pekar på vår egen /tid, och Blikks /tidrapport har
  // ingen rad alls. Båda halvorna prövas — en rad som pekar rätt är värdelös om den gamla ligger
  // kvar bredvid och delar besättningen mellan två system mitt i en löneperiod.
  it('leder tidrapporten till /tid för member och admin, utan en Blikk-rad kvar', () => {
    for (const role of ['member', 'admin'] as UserRole[]) {
      const hrefs = flatten(nav(role)).map((i) => i.href);
      expect(hrefs).toContain('/tid');
      expect(hrefs).not.toContain('/tidrapport');
      expect(flatten(nav(role)).find((i) => i.href === '/tid')?.label).toBe('Tidrapport');
    }
  });

  // Ingen annan roll fick raden på köpet av bytet.
  it('ger ingen ny roll tidrapporten genom bytet', () => {
    for (const role of ['sales', 'ekonomi', null] as Array<UserRole | null>) {
      expect(flatten(nav(role)).map((i) => i.href)).not.toContain('/tid');
    }
  });

  it('signs out nobody: an unknown role sees only ungated items', () => {
    const hrefs = flatten(nav(null)).map((i) => i.href);
    expect(hrefs).toContain('/');
    expect(hrefs).not.toContain('/admin');
  });

  // Lönebyrån (`ekonomi`) är EXTERN. Menyn är det enda som styr vart hon går av vana, och varje
  // rad som inte hör hemma där är antingen en återvändsgränd (redirect) eller en läcka.
  describe('rollen ekonomi — lönebyrån', () => {
    it('ser Tid & lön', () => {
      const entry = flatten(nav('ekonomi')).find((i) => i.href === '/ekonomi');
      expect(entry?.label).toBe('Tid & lön');
    });

    it('ser ingenting som rör kunder, planering, jobb eller administration', () => {
      const hrefs = flatten(nav('ekonomi')).map((i) => i.href);
      for (const forbidden of [
        '/crm', '/crm/planering', '/plannering', '/crm/korjournal', '/crm/dokument',
        '/mina-jobb', '/egenkontroll', '/archive', '/admin',
      ]) {
        expect(hrefs).not.toContain(forbidden);
      }
    });

    // ⚠️ KÄRNAN I EXPLICIT_ONLY_ROLES. En rad UTAN `roles` betyder "alla anställda", inte "alla som
    // råkar vara inloggade" — och lönebyrån är inte anställd. Utan opt-in-regeln fick hon Start,
    // Dokument & information, Kontakt & adresser och Felanmälan gratis bara genom att existera,
    // och varje FRAMTIDA ospärrad rad hade tillkommit på samma sätt, tyst.
    //
    // ⚠️ Skrivet mot REGELN, inte mot en lista adresser. Den tidigare varianten jämförde med
    // `['/ekonomi']` rakt av, och när fakturaunderlaget lades till 2026-09-18 föll testet på en
    // rad som var helt avsiktlig. Ett test som måste redigeras varje gång ytan växer slutar läsas
    // som en spärr och börjar läsas som ett hinder — och då stryks det förr eller senare. Det här
    // biter i stället på exakt det som är felet: en rad hon ser UTAN att den nämner henne.
    it('ser INGA ospärrade rader — bara det som nämner ekonomi vid namn', () => {
      const visible = flatten(nav('ekonomi'));
      expect(visible.length).toBeGreaterThan(0);
      for (const item of visible) {
        expect(item.roles, `raden ${item.href} syns för ekonomi utan att nämna rollen`).toContain('ekonomi');
      }
    });

    // Fakturaunderlaget: arbetsordrarna, skrivskyddade. Egen adress under /ekonomi — /crm ligger
    // bakom en rollgrind som kastar ut henne till startsidan.
    it('ser Arbetsordrar, och den pekar bort från /crm', () => {
      const entry = flatten(nav('ekonomi')).find((i) => i.label === 'Arbetsordrar');
      expect(entry?.href).toBe('/ekonomi/arbetsorder');
      expect(entry?.href.startsWith('/crm')).toBe(false);
    });

    // Regeln får inte läcka till någon annan. `null` ser fortfarande de ospärrade raderna: att
    // logga in och mötas av en tom meny är ett sämre fel än att se Start.
    it('rör inte de andra rollerna', () => {
      for (const role of ['member', 'sales', 'admin', null] as Array<UserRole | null>) {
        expect(flatten(nav(role)).map((i) => i.href)).toContain('/');
      }
      expect(flatten(nav('member')).map((i) => i.href)).toContain('/felanmalan');
    });

    // 🚫 Hon ska inte rapportera tid alls — varken i vår egen tidrapport eller i Blikks gamla.
    it('ser ingen tidrapport, ny eller gammal', () => {
      const hrefs = flatten(nav('ekonomi')).map((i) => i.href);
      expect(hrefs).not.toContain('/tid');
      expect(hrefs).not.toContain('/tidrapport');
    });

    // Raden är rollgatad, sidan är behörighetsgatad. Admin måste få BÅDA, annars är attesten bara
    // nåbar via adressen för den som äger systemet.
    it('ger admin samma rad, utan att någon annan roll får den', () => {
      expect(flatten(nav('admin')).map((i) => i.href)).toContain('/ekonomi');
      for (const role of ['member', 'sales', 'konsult', null] as Array<UserRole | null>) {
        expect(flatten(nav(role)).map((i) => i.href)).not.toContain('/ekonomi');
      }
    });
  });

  it('has no duplicate keys anywhere in the tree, groups included', () => {
    // Gruppens egen nyckel måste räknas med. Två grupper som delar 'group:dokument'
    // delar också sin rad i `expanded` (AppSidebar öppnar då båda på ett klick) och
    // sin React-key på <li>, vilket ger duplicate-key-varning och ostabil avstämning.
    const hrefs = APP_NAV_ITEMS.flatMap((i) => [i.href, ...(i.children?.map((c) => c.href) ?? [])]);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
