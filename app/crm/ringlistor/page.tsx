import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import CrmPlaceholder from '../components/CrmPlaceholder';

export const dynamic = 'force-dynamic';

export default async function CrmCallListsPage() {
  const profile = await getUserProfile();
  if (profile?.role !== 'admin') redirect('/crm');

  return (
    <CrmPlaceholder
      eyebrow="CRM / Ringlistor"
      title="Ringlistor"
      description="Ringlistor är adminytan för import, tilldelning och styrning av prospects in i säljarbetet. Den ska byggas så att listor kan växa utan att påverka den dagliga användningen för säljare."
      bullets={[
        'Skapa och hantera ringlistor.',
        'Importera prospects via Excel.',
        'Tilldela prospects manuellt eller via jämn fördelning.',
        'Förbereda deduplicering och framtida datakällor.',
      ]}
    />
  );
}