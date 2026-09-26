import type { ReactNode } from 'react';
import { requirePagePermission } from '@/lib/auth/pageGuards';

export const dynamic = 'force-dynamic';

// app.contacts.read — samma nyckel som /api/contacts, som sidan hämtar listan ifrån: sidan och rutten
// ska svara lika, annars landar en nekad i felgränsen i stället för på Start. (Seeden är densamma som
// app.access — alla anställda + konsult, inte lönebyrån — så det här stänger ingen anställd ute.)
export default async function Layout({ children }: { children: ReactNode }) {
  await requirePagePermission('app.contacts.read');
  return children;
}
