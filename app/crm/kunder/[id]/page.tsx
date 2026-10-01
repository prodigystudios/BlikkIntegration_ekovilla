import { Suspense } from 'react';
import { can, getEffectivePermissions } from '@/lib/auth/permissions';
import { getFortnoxConnectionStatus } from '@/lib/domains/fortnox/auth';
import { resolvePortalTarget } from '@/lib/domains/portal/config';
import CustomerDetailClient from '../CustomerDetailClient';

export const dynamic = 'force-dynamic';

export default async function KundProfilPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [fortnoxStatus, perms] = await Promise.all([
    getFortnoxConnectionStatus().catch(() => ({ connected: false })),
    getEffectivePermissions().catch(() => null),
  ]);
  // Partnerrutan (RESELLER_PORTAL_CRM_PLAN.md 10a): bara för crm.portal.manage, och bara där integrationen är påslagen.
  // I prod alltså först vid påslaget (fas 9). Routerna prövar behörigheten själva; det här avgör bara om rutan syns.
  const portalPartnerEnabled = Boolean(perms && can(perms, 'crm.portal.manage')) && resolvePortalTarget(process.env).ok;
  return (
    <Suspense>
      <CustomerDetailClient customerId={id} fortnoxConnected={fortnoxStatus.connected} portalPartnerEnabled={portalPartnerEnabled} />
    </Suspense>
  );
}
