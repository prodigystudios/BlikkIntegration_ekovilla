import type { KmaFormValues } from '@/lib/domains/crm/kmaPlans/types';

// Ett giltigt KMA-formulär att bygga dokument och rendera PDF:er ur. Påhittade personer och en
// påhittad order — skarp kunddata hör aldrig hemma i en committad fixtur.

export function kmaForm(overrides: Partial<KmaFormValues> = {}): KmaFormValues {
  const base: KmaFormValues = {
    v: 1,
    project: {
      projectName: 'Vindsbjälklag Hus A–C',
      customerName: 'Testfastigheter AB',
      projectNumber: '6579',
      properties: ['Testgatan 1, 811 21 Sandviken'],
      workType: 'tilläggsisolering',
      commitment: 'Tilläggsisolering / Isoleringsentreprenad',
      materials: ['EKOVILLA'],
    },
    organisation: {
      projectManager: { name: 'Petra Projektledare', phone: '070-000 00 01', email: 'petra@example.se' },
      workEnvironment: { name: 'Arne Arbetsmiljö', phone: '070-000 00 02', email: 'arne@example.se' },
      environment: { name: 'Mia Miljö', phone: '', email: '' },
      quality: { name: 'Kurt Kvalitet', phone: '070-000 00 03', email: 'kurt@example.se' },
      siteRoundsBy: 'Petra Projektledare',
      deviationRecipient: 'Ansvarig projektledare i vårt interna arbetssystem',
    },
    selfCheckResponsible: {
      incomingMaterial: 'Installatör',
      density: 'Installatör',
      thickness: 'Ledande installatör',
      airGaps: 'Installatör',
      finalInspection: 'Säljare/Projektledare',
    },
    contacts: [
      { name: 'Sara Säljare', role: 'Försäljningsansvarig', phone: '070-000 00 04' },
      { name: 'Lars Ledare', role: 'Ledande installatör', phone: '070-000 00 05' },
      { name: 'Ida Installatör', role: 'Installatör', phone: '' },
    ],
    signers: {
      ongoing: [
        { name: 'Lars Ledare', role: 'Ledande installatör' },
        { name: 'Ida Installatör', role: 'Installatör' },
      ],
      verifying: [{ name: 'Petra Projektledare', role: 'Arbetsledare' }],
    },
    extraRisks: [],
  };
  return { ...base, ...overrides };
}
