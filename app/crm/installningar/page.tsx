import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import CrmPlaceholder from '../components/CrmPlaceholder';

export const dynamic = 'force-dynamic';

export default async function CrmSettingsPage() {
  const profile = await getUserProfile();
  if (profile?.role !== 'admin') redirect('/crm');

  return (
    <CrmPlaceholder
      eyebrow="CRM / Inställningar"
      title="Inställningar"
      description="Här ska admin senare kunna styra mål, användarinställningar och externa integrationer för CRM-delen utan att påverka resten av appens adminytor mer än nödvändigt."
      bullets={[
        'Hantera CRM-relevanta mål och inställningar.',
        'Förbereda framtida Fortnox-kopplingar.',
        'Stödja CRM-specifika adminflöden utan att blanda ihop dem med huvudadmin.',
        'Hålla integrationsinställningar tydligt avgränsade.',
      ]}
    />
  );
}