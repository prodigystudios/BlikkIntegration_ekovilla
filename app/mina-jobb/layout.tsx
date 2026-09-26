import type { ReactNode } from 'react';
import { requirePagePermission } from '@/lib/auth/pageGuards';

export const dynamic = 'force-dynamic';

// Alla anställda (app.access) — inte lönebyrån, inte ett okänt konto. Menyraden gatas på en egen,
// snävare nyckel; sidan gatas medvetet bredare, så att ingen anställd tappar en väg hit som hen har
// i dag (t.ex. länkar från fältvyn). Beslut 2026-09-26.
export default async function Layout({ children }: { children: ReactNode }) {
  await requirePagePermission('app.access');
  return children;
}
