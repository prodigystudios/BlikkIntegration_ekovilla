export const dynamic = 'force-dynamic';

import KorjournalClient from './KorjournalClient';

// Auth + sales/admin gate + page shell come from app/crm/layout.tsx. Körjournal
// is personal per-user data (RLS scopes rows); this page only composes the client.
export default function CrmKorjournalPage() {
  return <KorjournalClient />;
}
