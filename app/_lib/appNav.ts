import type { UserRole } from '@/lib/roles';

// App-level navigation shown OUTSIDE the CRM context (start page + the per-role
// destinations that used to live in the global header / dashboard). The CRM
// context reuses its own nav (app/crm/_lib/nav.ts) when the path is under /crm.
//
// Role gating uses the *effective* role (konsult is resolved to sales upstream,
// consistent with lib/roles.ts filterLinks and the CRM layout).
//
// Shape mirrors CrmNavItem: an item with `children` renders as an expandable group
// in the sidebar. The frequent destinations stay flat on purpose — the collapsed
// 68px rail hides child lists entirely, so anything behind a group costs a hover
// (or a pin) to reach. Only the long tail is grouped.
export type AppNavItem = {
  // For a group this is an identity key, never a destination: the sidebar renders
  // group rows as a <button>, so it is only used for the expand state and the icon
  // lookup. Groups therefore carry a `group:` key instead of a URL, and
  // getVisibleAppNavItems drops any group whose children are all filtered away —
  // an empty group would otherwise fall through to the plain-link branch and
  // render `group:…` as an href.
  href: string;
  label: string;
  roles?: UserRole[]; // omitted = visible to all authenticated roles
  children?: AppNavItem[];
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: '/', label: 'Start' },

  // Sales / admin block
  { href: '/crm', label: 'CRM', roles: ['sales', 'admin'] },
  // Two planning worlds are live during the CRM cutover: new jobs are planned in CRM, the legacy
  // Blikk-backed board runs its remaining jobs to completion. Both are listed so the office can
  // reach either; the legacy one is labelled so nobody plans new work there by mistake. They stay
  // flat and adjacent — putting the current one behind a group would hide the destination people
  // actually want and leave the legacy board as the one you reach by reflex.
  { href: '/crm/planering', label: 'Planering', roles: ['sales', 'admin'] },
  { href: '/plannering', label: 'Planering (äldre)', roles: ['sales', 'admin'] },
  { href: '/crm/korjournal', label: 'Körjournal', roles: ['sales', 'admin'] },

  // Kalkylatorn (/offert/kalkylator) är MEDVETET UTE UR MENYN. Ytan används inte alls just nu och
  // ska byggas om eller tas bort — en meny-rad till något ingen ska använda är bara en väg att
  // råka gå fel. Rutten lever kvar, så gamla bokmärken och länkar fungerar som förut. Lägg tillbaka
  // raden här när ytan är ombyggd och beslutad:
  //   { href: '/offert/kalkylator', label: 'Kalkylator', roles: ['sales', 'admin'] },
  // (⚠️ startsidans snabblänkar i components/dashboard/ClientDashboard.tsx pekar fortfarande dit.)

  // Installer / member block
  { href: '/mina-jobb', label: 'Mina jobb', roles: ['member', 'admin'] },
  // Egenkontrollerna delade tidigare toppnivå som "Egenkontroll" och "Egenkontroller" — en bokstav
  // isär för två olika saker. De hör ihop, så de bor i en egen grupp med namnen utskrivna.
  // Sälj ser bara arkivet; enbarnsregeln nedan fäller då ihop gruppen till just den raden.
  {
    href: 'group:egenkontroll',
    label: 'Egenkontroll',
    children: [
      { href: '/egenkontroll', label: 'Ny egenkontroll', roles: ['member', 'admin'] },
      { href: '/archive', label: 'Sparade egenkontroller', roles: ['member', 'sales', 'admin'] },
    ],
  },
  // ⚠️ TIDRAPPORTEN PEKAR PÅ BLIKK OCH SKA FORTSÄTTA GÖRA DET.
  // Blikk är lönens system of record tills något annat uttryckligen beslutats. Den som av vana
  // klickar "Tidrapport" ska landa där hen alltid landat — att flytta folk därifrån ger samma
  // resultat som att stänga vägen: timmar som aldrig når lönekörningen. Byt inte namn, ta inte bort,
  // peka inte om. Den ligger kvar platt av samma skäl: en grupp är ett extra steg.
  { href: '/tidrapport', label: 'Tidrapport', roles: ['member', 'admin'] },

  // Den nya CRM-tidrapporten (/tid) ligger MEDVETET INTE i menyn under piloten. Rutten fungerar och
  // nås genom att skriva adressen — det räcker för att testa, och en halvtestad väg i menyn är en
  // inbjudan att rapportera fel av misstag. Lägg tillbaka den här först när piloten är avstämd mot
  // Blikk och cutovern är beslutad:
  //   { href: '/tid', label: 'Tidrapport', roles: ['member', 'sales', 'admin'] },
  // (och flytta då den gamla till "Tidrapport (Blikk)" eller ta bort den, på uttrycklig instruktion).

  // Shared — the long tail, grouped.
  {
    href: 'group:dokument',
    label: 'Dokument',
    children: [
      { href: '/mina-dokument', label: 'Mina dokument', roles: ['member', 'sales', 'admin'] },
      // Was "Dokument", which read as a fourth sibling of the three document rows.
      { href: '/crm/dokument', label: 'Dokumentbibliotek', roles: ['sales', 'admin'] },
      { href: '/dokument-information', label: 'Dokument & information' },
    ],
  },
  {
    href: 'group:ovrigt',
    label: 'Övrigt',
    children: [
      { href: '/kontakt-lista', label: 'Kontakt & adresser' },
      { href: '/nyheter', label: 'Nyheter', roles: ['member', 'sales', 'admin'] },
      { href: '/material-kvalitet', label: 'Materialkvalitet', roles: ['member', 'sales', 'admin'] },
      { href: '/bestallning-klader', label: 'Beställ kläder', roles: ['member', 'admin'] },
      // Sist i gruppen: det man söker upp när något är fel, inte något man gör i förbifarten.
      { href: '/felanmalan', label: 'Felanmälan' },
    ],
  },

  // Admin
  { href: '/admin', label: 'Admin', roles: ['admin'] },
];

function isItemVisible(item: AppNavItem, role: UserRole | null) {
  return !item.roles || (!!role && item.roles.includes(role));
}

// A group is nothing but its children, so what role gating leaves behind decides whether
// it still earns a row. None: it has no destination left to offer, and its `group:` key is
// not a URL to fall back on — drop it, or the sidebar's plain-link branch would render
// `href="group:…"`. One: a chevron that opens onto a single link is a click for nothing,
// so the child takes the row and names it.
function collapseGroup(item: AppNavItem, role: UserRole | null): AppNavItem[] {
  if (!item.children) return [item];
  const children = item.children.filter((child) => isItemVisible(child, role));
  if (children.length === 0) return [];
  if (children.length === 1) return [children[0]];
  return [{ ...item, children }];
}

export function getVisibleAppNavItems(role: UserRole | null): AppNavItem[] {
  return APP_NAV_ITEMS.filter((item) => isItemVisible(item, role)).flatMap((item) =>
    collapseGroup(item, role),
  );
}
