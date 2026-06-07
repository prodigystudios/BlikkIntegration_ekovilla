import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/route';
import WorkOrderInstallerClient from '../WorkOrderInstallerClient';

export const dynamic = 'force-dynamic';

// Field view for installers (and anyone). Lives outside /crm (which is office-only) so
// member-role staff can open it via a direct link. Read-only essentials + write on
// time/comments; editing the order stays in /crm/arbetsorder/[id] for CRM roles.
export default async function InstallerWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  return <WorkOrderInstallerClient workOrderId={id} currentUserId={user.id} />;
}
