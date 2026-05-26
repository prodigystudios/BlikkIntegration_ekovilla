import CrmPlaceholder from '../components/CrmPlaceholder';

export const dynamic = 'force-dynamic';

export default function CrmCoachPage() {
  return (
    <CrmPlaceholder
      eyebrow="CRM / Coach"
      title="Coach"
      description="Coach-sektionen är reserverad för senare säljhjäp, tips, notiser och AI-drivna flöden. Den ska bygga vidare på riktiga CRM-händelser när kärnan först finns på plats."
      bullets={[
        'Visa säljtips och kontextuella råd.',
        'Bygga vidare på coach events och målutfall.',
        'Förbereda realtidsnotiser och teampepp utan att störa kärnflödet.',
        'Hålla AI-delarna separerade från CRM:s grundfunktionalitet.',
      ]}
    />
  );
}