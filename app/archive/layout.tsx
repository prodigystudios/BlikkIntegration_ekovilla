import type { ReactNode } from 'react';
import { requirePagePermission } from '@/lib/auth/pageGuards';

export const dynamic = 'force-dynamic';

// Samma nyckel som /api/storage/list-all, som sidan hämtar ifrån: sidan och rutten ska svara lika.
// app.archive.read = alla anställda (member, sales, admin, konsult). Grinden i ROUTEN är den som
// skyddar filerna; den här ger ett nekande i stället för en felsida.
export default async function Layout({ children }: { children: ReactNode }) {
  await requirePagePermission('app.archive.read');
  return children;
}
