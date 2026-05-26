import CrmPlaceholder from '../components/CrmPlaceholder';

export const dynamic = 'force-dynamic';

export default function CrmAiProspectsPage() {
  return (
    <CrmPlaceholder
      eyebrow="CRM / AI Prospekt"
      title="AI Prospekt"
      description="AI-prospektering ligger senare i planen. Den här sektionen finns redan i skelettet så att informationsarkitekturen håller när funktionen väl byggs på riktigt."
      bullets={[
        'Bygga server-side sök- och extraktionsflöde mot externa källor.',
        'Spara förslag separat innan de blir riktiga prospects.',
        'Ge admin och säljare möjlighet att granska och importera.',
        'Hålla AI som ett tillägg, inte som beroende för kärnflödet.',
      ]}
    />
  );
}