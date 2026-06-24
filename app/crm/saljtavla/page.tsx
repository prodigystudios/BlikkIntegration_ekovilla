import { getCurrentUser } from '@/lib/auth/route';
import SaljtavlaClient from './SaljtavlaClient';

export const dynamic = 'force-dynamic';

export default async function CrmSaljtavlaPage() {
  const user = await getCurrentUser().catch(() => null);
  return <SaljtavlaClient currentUserId={user?.id ?? null} />;
}
