import { describe, it, expect } from 'vitest';
import { unpricedRowsIssue, untouchedUnpricedWarning, workOrderLineItemIssues } from '@/lib/domains/crm/lineItemIssues';

// Arbetsorderns spärrar före sparning. Utan prisspärren sparades raderna och FÖRST Fortnox-pushen
// sa nej — med ordern stämplad 'failed', faktureringen spärrad och ett 409 som inte pekade ut raden.
describe('workOrderLineItemIssues', () => {
  const priced = { id: 'a', article_name: 'Lösull', article_number: '13202', unit_price: '700', m2: '100', thickness_mm: '200' };

  it('släpper igenom prissatta rader', () => {
    expect(workOrderLineItemIssues([priced], { rotEnabled: false })).toEqual([]);
  });

  // ⚖️ KÄRNAN. En rad med mängd men utan prisförankring är 0 kr i Fortnox — och pushen avvisar den.
  it('spärrar en ny rad utan pris och pekar ut den med sitt radnummer', () => {
    const issues = workOrderLineItemIssues(
      [priced, { id: 'b', pricing_mode: 'item', quantity: '3', unit_price: '' }],
      { rotEnabled: false, savedRows: [priced] },
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

  // ⚖️ Antal 0 på en BEFINTLIG rad = inget levererades, och att sänka antalet till det levererade är
  // hur en delfakturerad order stängs. Ingen spärr där — prövad och backad i grenreviewen.
  it('godtar antal 0 på en befintlig rad', () => {
    const saved = { ...priced, pricing_mode: 'item' as const, quantity: '4' };
    expect(workOrderLineItemIssues([{ ...saved, quantity: '0' }], { rotEnabled: false, savedRows: [saved] })).toEqual([]);
  });

  // …men en NY rad utan mängd är ett glömt fält: 0 kr, tyst ur ordervärdet. Offerten spärrar den.
  it('spärrar en ny rad utan mängd', () => {
    expect(workOrderLineItemIssues([{ ...priced, id: 'ny', m2: '' }], { rotEnabled: false, savedRows: [priced] }))
      .toEqual(['Rad 1: mängd saknas — fyll i m² och tjocklek, eller antal']);
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

  // 🧨 ALLA rader, inte bara ändrade: det är ROT-påslaget i översikten som gör en gammal rad fel, så
  // en spärr på bara ändrade rader hade tigit just när den behövs.
  it('prövar arbetskostnaden även på en orörd rad', () => {
    const row = { ...priced, labor_cost: '700' };
    expect(workOrderLineItemIssues([row], { rotEnabled: true, savedRows: [row] })).toHaveLength(1);
  });

  // …utom på en fakturerad (låst) rad: dess arbetskostnad går inte att ändra, och en spärr man inte
  // kan åtgärda hade låst hela ordern.
  it('hoppar över låsta rader i ROT-spärren', () => {
    const row = { ...priced, labor_cost: '700' };
    expect(workOrderLineItemIssues([row], { rotEnabled: true, savedRows: [row], lockedIds: new Set(['a']) })).toEqual([]);
  });
});

// 🧨 BARA NYA OCH ÄNDRADE RADER. En gammal rad som redan ligger sparad fel hade annars låst varje
// sparning av ordern — även en som bara rör en helt annan rad.
describe('unpricedRowsIssue — bara nya och ändrade rader', () => {
  const legacy = { id: 'old', article_name: 'Frakt', pricing_mode: 'item', quantity: '1', unit_price: '' };

  it('låter en orörd gammal rad utan pris vara', () => {
    expect(unpricedRowsIssue([legacy], [legacy])).toBeNull();
  });

  it('spärrar den så fort den ändras', () => {
    expect(unpricedRowsIssue([{ ...legacy, quantity: '2' }], [legacy])).toContain('Rad 1: pris saknas');
  });

  // Servern får raderna GENOM Zod: tal blir strängar, defaults fylls i, nyckelordningen ändras och
  // ett tomt artikelpris blir null. En sådan rad är samma rad — annars hade den gamla raden räknats
  // som ändrad vid varje sparning och nekats med 422.
  it('läser en rad som bara passerat schemat som oförändrad', () => {
    const stored = { id: 'old', article_name: 'Lösull', m2: 40 as unknown as string, thickness_mm: '200', unit_price: '', article_price: '' as unknown as number };
    const parsed = { thickness_mm: '200', m2: '40', unit_price: '', article_name: 'Lösull', id: 'old', pricing_mode: 'm3', is_rot_work: false, written_off: false, quantity: '', article_price: null };
    expect(unpricedRowsIssue([parsed], [stored])).toBeNull();
  });
});

// Den orörda gamla raden spärrar inget — men synken kommer att fallera, och det ska sägas FÖRE.
describe('untouchedUnpricedWarning', () => {
  const legacy = { id: 'old', article_name: 'Frakt', pricing_mode: 'item', quantity: '1', unit_price: '' };

  it('varnar för en orörd rad utan pris', () => {
    expect(untouchedUnpricedWarning([legacy], [legacy])).toMatch(/^Rad 1 saknar pris sedan tidigare/);
  });

  // En ÄNDRAD rad är spärrens sak, inte varningens — samma rad ska inte sägas två gånger.
  it('tiger om en ändrad rad', () => {
    expect(untouchedUnpricedWarning([{ ...legacy, quantity: '2' }], [legacy])).toBeNull();
  });

  it('tiger när allt är prissatt', () => {
    expect(untouchedUnpricedWarning([{ ...legacy, unit_price: '500' }], [{ ...legacy, unit_price: '500' }])).toBeNull();
  });
});
