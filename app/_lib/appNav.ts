import type { UserRole } from '@/lib/roles';

// App-level navigation shown OUTSIDE the CRM context (start page + the per-role
// destinations that used to live in the global header / dashboard). The CRM
// context reuses its own nav (app/crm/_lib/nav.ts) when the path is under /crm.
//
// Role gating uses the *effective* role (konsult is resolved to sales upstream,
// consistent with lib/roles.ts filterLinks and the CRM layout).
export type AppNavItem = {
  href: string;
  label: string;
  roles?: UserRole[]; // omitted = visible to all authenticated roles
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: '/', label: 'Start' },

  // Sales / admin block
  { href: '/crm', label: 'CRM', roles: ['sales', 'admin'] },
  // Two planning worlds are live during the CRM cutover: new jobs are planned in CRM, the legacy
  // Blikk-backed board runs its remaining jobs to completion. Both are listed so the office can
  // reach either; the legacy one is labelled so nobody plans new work there by mistake.
  { href: '/crm/planering', label: 'Planering', roles: ['sales', 'admin'] },
  { href: '/plannering', label: 'Planering (äldre)', roles: ['sales', 'admin'] },
  { href: '/crm/korjournal', label: 'Körjournal', roles: ['sales', 'admin'] },
  { href: '/offert/kalkylator', label: 'Kalkylator', roles: ['sales', 'admin'] },

  // Installer / member block
  { href: '/mina-jobb', label: 'Mina jobb', roles: ['member', 'admin'] },
  { href: '/egenkontroll', label: 'Egenkontroll', roles: ['member', 'admin'] },
  { href: '/archive', label: 'Egenkontroller', roles: ['member', 'sales', 'admin'] },
  // Två tidrapporter är live under cutovern, precis som de två planeringarna ovan: den gamla skriver
  // till Blikk, den nya till CRM.
  //
  // ⚠️ DEN GAMLA BEHÅLLER NAMNET "Tidrapport" och rörs inte. Blikk är fortfarande lönens system of
  // record, och den som av vana klickar på "Tidrapport" ska landa där hen alltid landat — annars
  // flyttas folk från Blikk utan att någon beslutat det, och timmarna når aldrig lönekörningen.
  // Att byta namn är i praktiken att kapa vägen, även om koden är orörd. Namnen växlar först vid
  // cutovern (fas 4.6), på uttrycklig instruktion.
  //
  // Den nya är opt-in under piloten och visas även för sales — beslutet är att ALLA anställda ska
  // rapportera i CRM när det väl är skarpt, inte bara fältet.
  { href: '/tidrapport', label: 'Tidrapport', roles: ['member', 'admin'] },
  { href: '/tid', label: 'Tidrapport (ny)', roles: ['member', 'sales', 'admin'] },
  { href: '/bestallning-klader', label: 'Beställ kläder', roles: ['member', 'admin'] },
  { href: '/material-kvalitet', label: 'Materialkvalitet', roles: ['member', 'sales', 'admin'] },

  // Shared
  { href: '/felanmalan', label: 'Felanmälan' },
  { href: '/mina-dokument', label: 'Mina dokument', roles: ['member', 'sales', 'admin'] },
  { href: '/crm/dokument', label: 'Dokument', roles: ['sales', 'admin'] },
  { href: '/kontakt-lista', label: 'Kontakt & adresser' },
  { href: '/dokument-information', label: 'Dokument & information' },
  { href: '/nyheter', label: 'Nyheter', roles: ['member', 'sales', 'admin'] },

  // Admin
  { href: '/admin', label: 'Admin', roles: ['admin'] },
];

export function getVisibleAppNavItems(role: UserRole | null): AppNavItem[] {
  return APP_NAV_ITEMS.filter((item) => !item.roles || (!!role && item.roles.includes(role)));
}
