import type { UserRole } from '@/lib/roles';

export type CrmNavItem = {
  href: string;
  label: string;
  description: string;
  roles?: UserRole[];
};

export const CRM_NAV_ITEMS: CrmNavItem[] = [
  { href: '/crm', label: 'Översikt', description: 'Dagens läge och nästa steg', roles: ['sales', 'admin'] },
  { href: '/crm/samtal', label: 'Samtal', description: 'Ringlista och snabb loggning', roles: ['sales', 'admin'] },
  { href: '/crm/uppgifter', label: 'Uppgifter', description: 'Uppföljningar och deadlines', roles: ['sales', 'admin'] },
  { href: '/crm/offerter', label: 'Offerter', description: 'Offertflöde och uppföljning', roles: ['sales', 'admin'] },
  { href: '/crm/arbetsorder', label: 'Arbetsorder', description: 'Intern order och nästa operativa steg', roles: ['sales', 'admin'] },
  { href: '/crm/prospekt', label: 'Prospekt', description: 'Kundregister och kontakter', roles: ['sales', 'admin'] },
  { href: '/crm/affarsmojligheter', label: 'Affärsmöjligheter', description: 'Pipeline och aktiva affärer', roles: ['sales', 'admin'] },
  { href: '/crm/ringlistor', label: 'Ringlistor', description: 'Import, listor och tilldelning', roles: ['admin'] },
  { href: '/crm/ai-prospekt', label: 'AI Prospekt', description: 'Förslag och framtida prospektering', roles: ['admin'] },
  { href: '/crm/coach', label: 'Coach', description: 'Säljhjälp och kommande AI-stöd', roles: ['sales', 'admin'] },
  { href: '/crm/installningar', label: 'Inställningar', description: 'Mål, användare och integrationer', roles: ['admin'] },
];

export function getVisibleCrmNavItems(role: UserRole | null) {
  return CRM_NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)));
}