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
  { href: '/plannering', label: 'Planering', roles: ['sales', 'admin'] },
  { href: '/crm/korjournal', label: 'Körjournal', roles: ['sales', 'admin'] },
  { href: '/offert/kalkylator', label: 'Kalkylator', roles: ['sales', 'admin'] },
  { href: '/offert', label: 'Skapa offert', roles: ['admin'] },

  // Installer / member block
  { href: '/egenkontroll', label: 'Egenkontroll', roles: ['member', 'admin'] },
  { href: '/archive', label: 'Egenkontroller', roles: ['member', 'sales', 'admin'] },
  { href: '/tidrapport', label: 'Tidrapport', roles: ['member', 'admin'] },
  { href: '/bestallning-klader', label: 'Beställ kläder', roles: ['member', 'admin'] },
  { href: '/material-kvalitet', label: 'Materialkvalitet', roles: ['member', 'sales', 'admin'] },

  // Shared
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
