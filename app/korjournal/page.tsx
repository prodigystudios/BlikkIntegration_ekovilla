import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Körjournalen flyttade in i CRM-skalet (sälj/admin). Behåll stubben så att
// gamla bokmärken/länkar landar på den nya platsen. Icke-sälj/admin slussas
// vidare till '/' av app/crm/layout.tsx, enligt design.
export default function KorjournalRedirectPage() {
  redirect('/crm/korjournal');
}
