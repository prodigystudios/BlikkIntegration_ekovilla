import { Suspense } from 'react';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/route';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import { resolvePortalTarget } from '@/lib/domains/portal/config';
import CustomerDetailClient from '../CustomerDetailClient';

export const dynamic = 'force-dynamic';

export default async function KundProfilPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [fortnoxStatus, perms, user] = await Promise.all([
    getFortnoxConnectionStatus().catch(() => ({ connected: false })),
    getEffectivePermissions().catch(() => null),
    getCurrentUser().catch(() => null),
  ]);
  // Partnerrutan (RESELLER_PORTAL_CRM_PLAN.md 10a): bara för crm.portal.manage, och bara där integrationen är påslagen.
  // I prod alltså först vid påslaget (fas 9). Routerna prövar behörigheten själva; det här avgör bara om rutan syns.
  const portalPartnerEnabled = Boolean(perms && can(perms, 'crm.portal.manage')) && resolvePortalTarget(process.env).ok;
  return (
    <Suspense>
      <CustomerDetailClient
        customerId={id}
        fortnoxConnected={fortnoxStatus.connected}
        portalPartnerEnabled={portalPartnerEnabled}
        canDeleteCustomer={Boolean(perms && can(perms, 'crm.admin'))}
        canCreateQuote={Boolean(perms && can(perms, 'crm.offer.write'))}
        canCreateWorkOrder={Boolean(perms && can(perms, 'crm.workorder.write'))}
        canLogCall={Boolean(perms && can(perms, 'crm.call.write'))}
        canWriteTasks={Boolean(perms && can(perms, 'crm.write'))}
        canDelegateTasks={Boolean(perms && can(perms, 'crm.admin'))}
        canSeeAllCalls={Boolean(perms && can(perms, 'crm.admin'))}
        currentUserId={user?.id ?? null}
      />
    </Suspense>
  );
}
