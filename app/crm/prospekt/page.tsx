import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function CrmProspectsPage() {
  redirect('/crm/kunder');
}
