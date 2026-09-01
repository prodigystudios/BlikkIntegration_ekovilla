// `ekonomi` är lönebyrån: extern, ser ingen kund och inget pris, och har inget att göra i CRM:et.
// Rollen finns därför att ingen befintlig passade — `member` hade satt henne i sin egen attestlista
// och `konsult` mappas till sales nedan, vilket släpper in henne i hela kundregistret. Hennes enda
// yta är /ekonomi, och det som gör den nåbar är BEHÖRIGHETEN time.approve; rollen bär bara menyn.
export type UserRole = 'member' | 'sales' | 'admin' | 'konsult' | 'ekonomi';

export interface RoleAwareLink {
  href: string;
  label: string;
  roles?: UserRole[]; // if omitted -> visible to all
}

export const NAV_LINKS: RoleAwareLink[] = [
  { href: '/', label: 'Startsida' },
  { href: '/crm', label: 'CRM', roles: ['sales','admin'] },
  // /egenkontroll creation accessed via quick links only
  { href: '/archive', label: 'Sparade egenkontroller' },
  { href: '/kontakt-lista', label: 'Kontakt & Adresser' },
  { href: '/mina-dokument', label: 'Mina dokument' },
  { href: '/crm/dokument', label: 'Dokument', roles: ['sales','admin'] },
  { href: '/dokument-information', label: 'Dokument & Information' },
  { href: '/bestallning-klader', label: 'Beställning kläder', roles: ['member','admin'] },
  { href: '/crm/korjournal', label: 'Körjournal', roles: ['sales','admin'] },
  // Both planning worlds during the CRM cutover — see app/_lib/appNav.ts.
  { href: '/crm/planering', label: 'Planering', roles: ['sales','admin'] },
  { href: '/plannering', label: 'Planering (äldre)', roles: ['sales','admin'] },
  { href: '/mina-jobb', label: 'Mina jobb', roles: ['member','admin'] },
  // Vår egen tidrapport sedan cutovern 2026-09-01 — Blikks /tidrapport länkas inte längre.
  { href: '/tid', label: 'Tidrapport', roles: ['member','admin'] },
  // Future admin-only examples:
  // { href: '/admin/users', label: 'Användare', roles: ['admin'] },
];

// konsult har samma vy-rättigheter som sales i hela appen. Regeln stod i fem kopior —
// sidenaven, CRM-grinden, CRM-sidan, dashboarden och filterLinks — och en sjätte roll som
// ska läsas som sälj hade behövt hittas med grep på fem ställen. Den som missas ger en tyst
// divergens: en användare som släpps igenom CRM-grinden men ser en annan meny än den ytan
// hon står på.
export function toEffectiveRole(role: UserRole | null | undefined): UserRole | null {
  if (!role) return null;
  return role === 'konsult' ? 'sales' : role;
}

export function filterLinks(role: UserRole | null) {
  const effectiveRole = toEffectiveRole(role);
  return NAV_LINKS.filter(l => !l.roles || (effectiveRole && l.roles.includes(effectiveRole)));
}
