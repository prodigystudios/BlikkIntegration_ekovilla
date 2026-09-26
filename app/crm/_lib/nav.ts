import type { PermissionKey } from '@/lib/auth/permissions';

// CRM:ets sidomeny. Varje rad gatas på samma nyckel som sidan den leder till (CRM-layouten kräver
// crm.access, adminsidorna sina egna nycklar) — en rad syns alltså bara för den som också når sidan.
// Nycklarnas seed är dagens rollmängd, så bytet från roller flyttade ingen rad för någon roll:
// tests/shared/crmNav.test.ts jämför mot en fryst kopia av den rollstyrda menyn.
export type CrmNavItem = {
  href: string;
  label: string;
  description: string;
  // Alla nycklar krävs (en lista = alla). Utelämnad = synlig för alla som når CRM:et.
  permission?: PermissionKey | PermissionKey[];
  // Optional sub-items rendered as an expandable group in the navigation.
  children?: CrmNavItem[];
};

export const CRM_NAV_ITEMS: CrmNavItem[] = [
  { href: '/crm', label: 'Översikt', description: 'Dagens läge och nästa steg', permission: 'crm.access' },
  { href: '/crm/kunder', label: 'Kunder', description: 'Prospekt, kunder och Fortnox-konton', permission: 'crm.access' },
  { href: '/crm/offerter', label: 'Offerter', description: 'Offertflöde och uppföljning', permission: 'crm.access' },
  { href: '/crm/arbetsorder', label: 'Arbetsorder', description: 'Intern order och nästa operativa steg', permission: 'crm.access' },
  { href: '/crm/planering', label: 'Planering', description: 'Schemalägg arbetsordrar på bilar', permission: ['crm.access', 'planning.schedule.read'] },
  { href: '/crm/samtal', label: 'Samtal', description: 'Ringlista och snabb loggning', permission: 'crm.access' },
  { href: '/crm/uppgifter', label: 'Uppgifter', description: 'Uppföljningar och deadlines', permission: 'crm.access' },
  { href: '/crm/saljtavla', label: 'Säljtavla', description: 'Offertflöde per status', permission: 'crm.access' },
  { href: '/crm/rapportering', label: 'Rapportering', description: 'Försäljningsrapporter och nyckeltal', permission: 'crm.access' },
  { href: '/crm/ringlistor', label: 'Ringlistor', description: 'Import, listor och tilldelning', permission: 'crm.admin' },
  { href: '/crm/ai-prospekt', label: 'AI Prospekt', description: 'Förslag och framtida prospektering', permission: 'crm.aiprospect.manage' },
  { href: '/crm/coach', label: 'Coach', description: 'Säljhjälp och kommande AI-stöd', permission: 'crm.access' },
  { href: '/crm/dokument', label: 'Dokument', description: 'Dokumentbibliotek och publicering', permission: 'crm.access' },
  { href: '/crm/korjournal', label: 'Körjournal', description: 'Registrera och följ upp resor', permission: 'crm.access' },
  {
    href: '/crm/installningar',
    label: 'Inställningar',
    description: 'Mål, användare och integrationer',
    permission: 'crm.settings.manage',
    children: [
      { href: '/crm/installningar', label: 'Översikt', description: 'Mål, användare och integrationer', permission: 'crm.settings.manage' },
      { href: '/crm/installningar/artiklar', label: 'Artiklar', description: 'Skapa och redigera Fortnox-artiklar', permission: 'crm.article.manage' },
      { href: '/crm/installningar/enheter', label: 'Enheter', description: 'Hantera Fortnox-enheter', permission: 'crm.unit.manage' },
    ],
  },
];

export type CanFn = (key: PermissionKey) => boolean;

function isItemVisible(item: CrmNavItem, can: CanFn) {
  if (!item.permission) return true;
  return (Array.isArray(item.permission) ? item.permission : [item.permission]).every(can);
}

// `can` svarar för den inloggades effektiva behörigheter (tom mängd → inga rader: den som saknar
// crm.access når inte CRM:et alls).
export function getVisibleCrmNavItems(can: CanFn): CrmNavItem[] {
  return CRM_NAV_ITEMS.filter((item) => isItemVisible(item, can)).map((item) =>
    item.children
      ? { ...item, children: item.children.filter((child) => isItemVisible(child, can)) }
      : item,
  );
}