import CrmPlaceholder from '../components/CrmPlaceholder';

export const dynamic = 'force-dynamic';

export default function CrmQuotesPage() {
  return (
    <CrmPlaceholder
      eyebrow="CRM / Offerter"
      title="Offerter"
      description="Offertflödet börjar som en intern CRM-yta för registrering och uppföljning. Senare kan den kopplas till Fortnox-kunddata, artikelrader och skapande av skarpa Fortnox-offerter."
      bullets={[
        'Registrera offert mot prospect eller kund.',
        'Spara projektnamn, summa och ansvarig säljare.',
        'Skapa uppföljning direkt efter offert.',
        'Förbereda senare Fortnox-integration utan att låsa första implementationen.',
      ]}
    />
  );
}