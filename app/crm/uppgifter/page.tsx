import CrmPlaceholder from '../components/CrmPlaceholder';

export const dynamic = 'force-dynamic';

export default function CrmTasksPage() {
  return (
    <CrmPlaceholder
      eyebrow="CRM / Uppgifter"
      title="Uppgifter"
      description="Den här sektionen ska samla alla uppföljningar och deadlines från samtal, offerter och manuellt arbete. Fokus i första versionen är enkel överblick och snabb avprickning."
      bullets={[
        'Visa öppna, förfallna och klara uppgifter med tydlig statusfärg.',
        'Koppla uppgifter till prospects och ansvarig användare.',
        'Stöd för att skapa ny uppföljning direkt när en uppgift markeras klar.',
        'Förbereda för daglig digest och framtida påminnelseflöden.',
      ]}
    />
  );
}