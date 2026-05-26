import CrmPlaceholder from '../components/CrmPlaceholder';

export const dynamic = 'force-dynamic';

export default function CrmCallsPage() {
  return (
    <CrmPlaceholder
      eyebrow="CRM / Samtal"
      title="Samtal"
      description="Här ska säljarens aktiva ringlista, prospektkort och snabb loggning av samtal byggas ut först. Ytan ska vara snabb att jobba i och ge direkt väg vidare till uppföljning."
      bullets={[
        'Visa ringlista sorterad efter prioritet, ålder och ansvarig säljare.',
        'Logga samtal med kommentar och positivt/negativt utfall.',
        'Öppna uppföljningsdialog direkt efter loggat samtal.',
        'Stöd för framtida omfördelning av prospekt vid negativt utfall.',
      ]}
    />
  );
}