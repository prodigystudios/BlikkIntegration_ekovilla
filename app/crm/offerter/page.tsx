import { getCurrentUser } from '@/lib/auth/route';
import QuotesClient from './QuotesClient';

export const dynamic = 'force-dynamic';

export default async function CrmQuotesPage() {
  const user = await getCurrentUser().catch(() => null);
  return <QuotesClient currentUserId={user?.id ?? null} />;
}
