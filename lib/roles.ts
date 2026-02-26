export type UserRole = 'member' | 'sales' | 'admin' | 'konsult';

export interface RoleAwareLink {
  href: string;
  label: string;
  roles?: UserRole[]; // if omitted -> visible to all
}

export const NAV_LINKS: RoleAwareLink[] = [
  { href: '/', label: 'Startsida' },
  // /egenkontroll creation accessed via quick links only
  { href: '/archive', label: 'Sparade egenkontroller' },
  { href: '/kontakt-lista', label: 'Kontakt & Adresser' },
  { href: '/dokument', label: 'Dokument' },
  { href: '/dokument-information', label: 'Dokument & Information' },
  { href: '/bestallning-klader', label: 'Beställning kläder', roles: ['member','admin'] },
  { href: '/korjournal', label: 'Körjournal', roles: ['sales','admin'] },
  { href: '/plannering', label: 'Planering', roles: ['sales','admin'] },
  { href: '/tidrapport', label: 'Tidrapport', roles: ['member','admin'] },
  // Future admin-only examples:
  // { href: '/admin/users', label: 'Användare', roles: ['admin'] },
];

export function filterLinks(role: UserRole | null) {
  // konsult should have the same viewing permissions as sales.
  const effectiveRole: UserRole | null = role === 'konsult' ? 'sales' : role;
  return NAV_LINKS.filter(l => !l.roles || (effectiveRole && l.roles.includes(effectiveRole)));
}
