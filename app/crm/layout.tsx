import type { ReactNode } from 'react';
import { requirePagePermission } from '@/lib/auth/pageGuards';

export const dynamic = 'force-dynamic';

// Hela CRM:et: crm.access (sales, admin, konsult — konsult läser). Nekad → Start, som alltid renderar.
// ⛔ Lönebyrån (ekonomi) har INTE crm.access, och ska inte ha den: fakturaunderlaget har en egen yta
// (/ekonomi/arbetsorder) just för att hela /crm ligger bakom den här grinden.
export default async function CrmLayout({ children }: { children: ReactNode }) {
  await requirePagePermission('crm.access');
  return <>{children}</>;
}
