import { describe, it, expect } from 'vitest';
import { getMaterialTheme, materialPill } from '@/components/dashboard/schedule/materialTheme';

// Stoppkortets materialetikett. job_type är fritext i den gamla planeringen och en nyckel i CRM.

describe('materialPill', () => {
  it('känner igen materialen i båda planeringarnas form', () => {
    expect(materialPill('ekovilla').label).toBe('Ekovilla');
    expect(materialPill('Ekovilla').label).toBe('Ekovilla');
    expect(materialPill('vitull')).toEqual({ label: 'Vitull', className: 'bg-[#e0f2fe] text-[#075985]', dotClassName: 'bg-[#0284c7]' });
  });

  it('skriver en jobbtyp som inte är ett material med sitt namn, inte som ett saknat material', () => {
    expect(materialPill('leverans').label).toBe('Leverans');
    // En typ admin lagt till efteråt finns inte i standardlistan och kommer som sin nyckel.
    expect(materialPill('takarbete').label).toBe('Takarbete');
  });

  it('säger i klartext när materialet saknas', () => {
    expect(materialPill(null)).toEqual({ label: 'Material ej angivet', className: 'bg-[#f1f5f9] text-[#334155]', dotClassName: 'bg-[#64748b]' });
    expect(materialPill('  ').label).toBe('Material ej angivet');
  });
});

describe('getMaterialTheme', () => {
  it('ger detaljmodalen samma färger som förut', () => {
    expect(getMaterialTheme('Ekovilla')).toEqual({ accent: '#16a34a', badgeBg: '#dcfce7', badgeFg: '#166534', label: 'Ekovilla' });
    expect(getMaterialTheme(undefined).label).toBeNull();
  });
});
