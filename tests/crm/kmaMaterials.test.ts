import { describe, it, expect } from 'vitest';

import { MATERIALS, MATERIAL_SHORTS } from '@/lib/domains/crm/materials';
import {
  KMA_MATERIAL_INFO,
  kmaEnvironmentSentences,
  kmaHasCellulose,
  kmaLambda,
  kmaMaterialHandlingLines,
  kmaMaterialPhrase,
  kmaMaterialsFromLineItems,
  kmaSelfCheckProducts,
} from '@/lib/domains/crm/kmaPlans/materials';

// Materialet i KMA-planen är ett PÅSTÅENDE till beställaren: vilket certifikat isoleringen har och
// vad den är gjord av. Testerna vaktar att påståendet kommer ur materialtabellen och följer orderns
// faktiska material — mallens egen glasullsrad bar Ekovillas ETA-nummer.

const blown = (article: string, overrides: Record<string, unknown> = {}) => ({
  article_name: article,
  pricing_mode: 'm3',
  m2: '100',
  thickness_mm: '300',
  density: '30',
  ...overrides,
});

describe('KMA_MATERIAL_INFO', () => {
  it('täcker varje materialkod i katalogen', () => {
    for (const short of MATERIAL_SHORTS) {
      expect(KMA_MATERIAL_INFO[short], short).toBeDefined();
    }
  });

  it('varje certifikat står i sin materialnyckel — en omdöpt artikel fångas här', () => {
    for (const [key, material] of Object.entries(MATERIALS)) {
      expect(key, material.short).toContain(KMA_MATERIAL_INFO[material.short].certificate);
    }
  });
});

describe('kmaMaterialsFromLineItems', () => {
  it('hittar de blåsta materialen, i katalogordning och utan dubbletter', () => {
    const items = [
      blown('KNAUF SUPAFIL FRAME'),
      blown('EKOVILLA LÖSULL'),
      blown('Ekovilla lösull vind'),
    ];
    expect(kmaMaterialsFromLineItems(items)).toEqual(['EKOVILLA', 'KNAUF SUPAFIL']);
  });

  it('skivor med varumärket (EKOVILLA LEVY, styckpris) är inte lösull', () => {
    expect(kmaMaterialsFromLineItems([blown('EKOVILLA LEVY 30MM', { pricing_mode: 'item', density: '' })])).toEqual([]);
  });

  it('en avskriven rad räknas inte', () => {
    expect(kmaMaterialsFromLineItems([blown('KNAUF SUPAFIL FRAME', { written_off: true })])).toEqual([]);
  });

  it('tål skräp', () => {
    expect(kmaMaterialsFromLineItems(null)).toEqual([]);
    expect(kmaMaterialsFromLineItems([null, 3, 'text'])).toEqual([]);
  });
});

describe('kmaMaterialPhrase', () => {
  it('utan material står en allmän formulering, inget påstått material', () => {
    expect(kmaMaterialPhrase([])).toBe('lösullsisolering');
  });

  it('en sort', () => {
    expect(kmaMaterialPhrase(['EKOVILLA'])).toBe('cellulosaisolering (lösull)');
    expect(kmaMaterialPhrase(['KNAUF SUPAFIL'])).toBe('glasullsisolering (lösull)');
  });

  it('två cellulosamaterial är fortfarande en sort', () => {
    expect(kmaMaterialPhrase(['EKOVILLA', 'ISOCELL/ISECO'])).toBe('cellulosaisolering (lösull)');
  });

  it('flera sorter räknas upp med "och"', () => {
    expect(kmaMaterialPhrase(['KNAUF SUPAFIL', 'EKOVILLA'])).toBe('cellulosaisolering och glasullsisolering (lösull)');
  });

  it('okända koder ignoreras', () => {
    expect(kmaMaterialPhrase(['ROCKWOOL'])).toBe('lösullsisolering');
  });
});

describe('kmaMaterialHandlingLines', () => {
  it('Knauf får Knaufs certifikat — inte mallens felkopierade ETA-nummer', () => {
    const [line] = kmaMaterialHandlingLines(['KNAUF SUPAFIL']);
    expect(line).toBe('Endast godkänd glasullsisolering (Knauf Supafil, B0709EPCR)');
    expect(line).not.toContain('09/0081');
  });

  it('Ekovilla får ETA-09/0081', () => {
    expect(kmaMaterialHandlingLines(['EKOVILLA'])).toEqual(['Endast godkänd cellulosaisolering (Ekovilla, CE ETA-09/0081)']);
  });
});

describe('kmaEnvironmentSentences', () => {
  it('cellulosameningen bara vid cellulosa, Knaufmeningen bara vid Knauf', () => {
    expect(kmaEnvironmentSentences(['EKOVILLA']).join(' ')).toContain('tidningspapper');
    expect(kmaEnvironmentSentences(['EKOVILLA']).join(' ')).not.toContain('Knauf');
    expect(kmaEnvironmentSentences(['KNAUF SUPAFIL']).join(' ')).toContain('Knauf');
    expect(kmaEnvironmentSentences(['KNAUF SUPAFIL']).join(' ')).not.toContain('tidningspapper');
  });

  it('för material utan egen mening i bolagets texter står ingen mening', () => {
    expect(kmaEnvironmentSentences(['PAROC'])).toEqual([]);
    expect(kmaEnvironmentSentences(['HUNTON NATIVO'])).toEqual([]);
  });

  it('båda när ordern har båda', () => {
    expect(kmaEnvironmentSentences(['EKOVILLA', 'KNAUF SUPAFIL'])).toHaveLength(2);
  });
});

describe('bilaga 6 — material', () => {
  it('Ekovillas ETA-formulering och FSC-mening står bara på Ekovilla', () => {
    const [ekovilla] = kmaSelfCheckProducts(['EKOVILLA']);
    expect(ekovilla.text).toContain('öppna och slutna konstruktioner');
    expect(ekovilla.text).toContain('FSC');
    const [knauf] = kmaSelfCheckProducts(['KNAUF SUPAFIL']);
    expect(knauf.text).toBe('Produktcertifikat: B0709EPCR');
  });

  it('takfotsnoten hör till cellulosa', () => {
    expect(kmaHasCellulose(['EKOVILLA'])).toBe(true);
    expect(kmaHasCellulose(['ISOCELL/ISECO'])).toBe(true);
    expect(kmaHasCellulose(['KNAUF SUPAFIL'])).toBe(false);
  });

  it('λ med komma vid exakt ett material, annars tomt', () => {
    expect(kmaLambda(['EKOVILLA'])).toBe('0,038');
    expect(kmaLambda(['PAROC'])).toBe('0,041');
    expect(kmaLambda(['EKOVILLA', 'KNAUF SUPAFIL'])).toBe('');
    expect(kmaLambda([])).toBe('');
  });
});
