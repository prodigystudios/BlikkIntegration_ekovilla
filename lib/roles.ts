export type UserRole = 'member' | 'sales' | 'admin';

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
  { href: '/dokument-information', label: 'Dokument & Information' },
  { href: '/bestallning-klader', label: 'Beställning kläder', roles: ['member','admin'] },
  { href: '/korjournal', label: 'Körjournal', roles: ['sales','admin'] },
  { href: '/planering', label: 'Planering', roles: ['sales','admin'] },
  // Future admin-only examples:
  // { href: '/admin/users', label: 'Användare', roles: ['admin'] },
];

export function filterLinks(role: UserRole | null) {
  return NAV_LINKS.filter(l => !l.roles || (role && l.roles.includes(role)));
}
