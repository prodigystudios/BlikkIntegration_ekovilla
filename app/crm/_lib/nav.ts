import type { UserRole } from '@/lib/roles';

export type CrmNavItem = {
  href: string;
  label: string;
  description: string;
  roles?: UserRole[];
  // Optional sub-items rendered as an expandable group in the navigation.
  children?: CrmNavItem[];
};

export const CRM_NAV_ITEMS: CrmNavItem[] = [
  { href: '/crm', label: 'Översikt', description: 'Dagens läge och nästa steg', roles: ['sales', 'admin'] },
  { href: '/crm/kunder', label: 'Kunder', description: 'Prospekt, kunder och Fortnox-konton', roles: ['sales', 'admin'] },
  { href: '/crm/offerter', label: 'Offerter', description: 'Offertflöde och uppföljning', roles: ['sales', 'admin'] },
  { href: '/crm/arbetsorder', label: 'Arbetsorder', description: 'Intern order och nästa operativa steg', roles: ['sales', 'admin'] },
  { href: '/crm/planering', label: 'Planering', description: 'Schemalägg arbetsordrar på bilar', roles: ['sales', 'admin'] },
  { href: '/crm/samtal', label: 'Samtal', description: 'Ringlista och snabb loggning', roles: ['sales', 'admin'] },
  { href: '/crm/uppgifter', label: 'Uppgifter', description: 'Uppföljningar och deadlines', roles: ['sales', 'admin'] },
  { href: '/crm/saljtavla', label: 'Säljtavla', description: 'Offertflöde per status', roles: ['sales', 'admin'] },
  { href: '/crm/rapportering', label: 'Rapportering', description: 'Försäljningsrapporter och nyckeltal', roles: ['sales', 'admin'] },
  { href: '/crm/ringlistor', label: 'Ringlistor', description: 'Import, listor och tilldelning', roles: ['admin'] },
  { href: '/crm/ai-prospekt', label: 'AI Prospekt', description: 'Förslag och framtida prospektering', roles: ['admin'] },
  { href: '/crm/coach', label: 'Coach', description: 'Säljhjälp och kommande AI-stöd', roles: ['sales', 'admin'] },
  {
    href: '/crm/installningar',
    label: 'Inställningar',
    description: 'Mål, användare och integrationer',
    roles: ['admin'],
    children: [
      { href: '/crm/installningar', label: 'Översikt', description: 'Mål, användare och integrationer', roles: ['admin'] },
      { href: '/crm/installningar/artiklar', label: 'Artiklar', description: 'Skapa och redigera Fortnox-artiklar', roles: ['admin'] },
      { href: '/crm/installningar/enheter', label: 'Enheter', description: 'Hantera Fortnox-enheter', roles: ['admin'] },
    ],
  },
];

function isItemVisible(item: CrmNavItem, role: UserRole | null) {
  return !item.roles || (!!role && item.roles.includes(role));
}

export function getVisibleCrmNavItems(role: UserRole | null): CrmNavItem[] {
  return CRM_NAV_ITEMS.filter((item) => isItemVisible(item, role)).map((item) =>
    item.children
      ? { ...item, children: item.children.filter((child) => isItemVisible(child, role)) }
      : item,
  );
}