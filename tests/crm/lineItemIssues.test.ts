import { describe, it, expect } from 'vitest';
import { workOrderLineItemIssues } from '@/lib/domains/crm/lineItemIssues';

// Arbetsorderns spärrar före sparning. Utan dem sparades raderna och FÖRST Fortnox-pushen sa nej —
// med ordern stämplad 'failed', faktureringen spärrad och ett 409 som inte pekade ut raden.
describe('workOrderLineItemIssues', () => {
  const priced = { id: 'a', article_name: 'Lösull', article_number: '13202', unit_price: '700', m2: '100', thickness_mm: '200' };

  it('släpper igenom prissatta rader', () => {
    expect(workOrderLineItemIssues([priced], { rotEnabled: false })).toEqual([]);
  });

  // ⚖️ KÄRNAN. En rad med mängd men utan prisförankring är 0 kr i Fortnox — och pushen avvisar den.
  it('spärrar en ifylld rad utan pris och pekar ut den med sitt radnummer', () => {
    const issues = workOrderLineItemIssues(
      [priced, { id: 'b', pricing_mode: 'item', quantity: '3', unit_price: '' }],
      { rotEnabled: false },
    );
    expect(issues).toEqual(['Rad 2: pris saknas — välj artikel, ange A-pris, eller skriv 0 om raden ingår']);
  });

  // En SKRIVEN nolla är ett beslut ("ingår"), inte en tom ruta.
  it('godtar ett skrivet nollpris', () => {
    expect(workOrderLineItemIssues([{ id: 'b', pricing_mode: 'item', quantity: '1', unit_price: '0' }], { rotEnabled: false })).toEqual([]);
  });

  // Artikelns pris räcker som förankring, precis som i pushen (lineItemUnitPrice).
  it('godtar en rad som prissätts av artikeln', () => {
    expect(workOrderLineItemIssues([{ id: 'b', article_name: 'Frakt', article_price: 500, pricing_mode: 'item', quantity: '1' }], { rotEnabled: false })).toEqual([]);
  });

  // Avskrivna rader skickas inte till Fortnox, och en ren radtext pushas som textrad — ingen av dem
  // ska kunna spärra en sparning. Tomma rader (ett oanvänt "+ Lägg till rad") sparas inte alls.
  it('prövar inte avskrivna rader, textrader eller tomma rader', () => {
    const issues = workOrderLineItemIssues([
      { id: 'w', pricing_mode: 'item', quantity: '3', unit_price: '', written_off: true },
      { id: 't', line_note: 'Tänk på hunden' },
      { id: 'e', pricing_mode: 'm3', m2: '', thickness_mm: '' },
    ], { rotEnabled: false });
    expect(issues).toEqual([]);
  });

  it('räknar ihop flera rader utan pris i ett besked', () => {
    const bad = (id: string) => ({ id, pricing_mode: 'item' as const, quantity: '1', unit_price: '' });
    expect(workOrderLineItemIssues([bad('a'), priced, bad('c')], { rotEnabled: false })[0])
      .toBe('Rader 1, 3: pris saknas — välj artikel, ange A-pris, eller skriv 0 om raden ingår');
  });

  // En ifylld rad utan mängd är 0 kr — i Fortnox och i ordervärdet. Offerten spärrar den också.
  it('spärrar en ifylld rad utan mängd', () => {
    expect(workOrderLineItemIssues([
      { id: 'm', article_name: 'Lösull', unit_price: '700', pricing_mode: 'm3', m2: '40', thickness_mm: '' },
      { id: 'i', article_name: 'Brandmatta', unit_price: '90', pricing_mode: 'item', quantity: '' },
    ], { rotEnabled: false })).toEqual(['Rader 1, 2: mängd saknas — fyll i m² och tjocklek, eller antal']);
  });

  // En arbetskostnad som äter hela A-priset bryter inte ut något — ordern hade gått till Fortnox
  // utan det ROT-underlag säljaren tror att den har.
  it('spärrar en arbetskostnad som äter hela A-priset när ROT är på', () => {
    const row = { ...priced, labor_cost: '700' };
    expect(workOrderLineItemIssues([row], { rotEnabled: true }))
      .toEqual(['Rad 1: arbetskostnaden äter hela A-priset — inget material blir kvar']);
    // …men inte när ROT är av (fältet läses då inte), och inte på en helt flaggad ROT-rad.
    expect(workOrderLineItemIssues([row], { rotEnabled: false })).toEqual([]);
    expect(workOrderLineItemIssues([{ ...row, is_rot_work: true }], { rotEnabled: true })).toEqual([]);
  });
});
