import { describe, it, expect } from 'vitest';
import { unpricedRowsIssue, workOrderLineItemIssues, workOrderLineItemWarnings } from '@/lib/domains/crm/lineItemIssues';

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

  // En ORÖRD rad spärrar aldrig — den får en varning (workOrderLineItemWarnings). Annars hade en
  // gammal rad låst varje sparning av ordern, även en som rör en annan rad.
  it('spärrar inte en orörd rad vars arbetskostnad äter A-priset', () => {
    const row = { ...priced, labor_cost: '700' };
    expect(workOrderLineItemIssues([row], { rotEnabled: true, savedRows: [row] })).toEqual([]);
  });

  // En fakturerad (låst) rad kan inte få sin arbetskostnad ändrad — en spärr där gick inte att åtgärda.
  it('hoppar över låsta rader i ROT-spärren', () => {
    const saved = { ...priced, labor_cost: '100' };
    const row = { ...priced, labor_cost: '700' };
    expect(workOrderLineItemIssues([row], { rotEnabled: true, savedRows: [saved], lockedIds: new Set(['a']) })).toEqual([]);
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

// 🧨 Fakturerade rader prövas inte. Deras pris går inte att ändra, och en spärr hade hindrat att
// antalet sänks till det fakturerade — alltså att ordern stängs.
describe('unpricedRowsIssue — låsta rader', () => {
  it('spärrar inte en fakturerad rad utan pris vars antal sänks', () => {
    const invoiced = { id: 'inv', article_name: 'Frakt', pricing_mode: 'item', quantity: '5', unit_price: '' };
    expect(unpricedRowsIssue([{ ...invoiced, quantity: '3' }], [invoiced], new Set(['inv']))).toBeNull();
  });

  // Schemat gör om ett tomt artikelpris till null — frågan ställs mot det som faktiskt sparas.
  it('läser ett tomt artikelpris som frånvaro', () => {
    const row = { id: 'n', article_name: 'Frakt', pricing_mode: 'item', quantity: '1', unit_price: '', article_price: '' as unknown as number };
    expect(unpricedRowsIssue([row], [])).toContain('pris saknas');
  });
});

// Det editorn ska SÄGA men inte spärra.
describe('workOrderLineItemWarnings', () => {
  const legacy = { id: 'old', article_name: 'Frakt', pricing_mode: 'item', quantity: '1', unit_price: '' };
  const base = { rotEnabled: false };

  it('varnar för en orörd rad utan pris', () => {
    expect(workOrderLineItemWarnings([legacy], { ...base, savedRows: [legacy] })[0]).toMatch(/^Rad 1 saknar pris sedan tidigare/);
  });

  // Rå JSONB kan bära '' som artikelpris. Editorn läste det som prissatt — schemat gör det till null,
  // och pushen fallerar efter sparningen. Varningen ska säga det FÖRE.
  it('varnar även när artikelpriset är en tom sträng', () => {
    const row = { ...legacy, article_price: '' as unknown as number };
    expect(workOrderLineItemWarnings([row], { ...base, savedRows: [row] })).toHaveLength(1);
  });

  // En ÄNDRAD rad är spärrens sak, inte varningens — samma rad ska inte sägas två gånger.
  it('tiger om en ändrad rad', () => {
    expect(workOrderLineItemWarnings([{ ...legacy, quantity: '2' }], { ...base, savedRows: [legacy] })).toEqual([]);
  });

  // Ett råd om att ge raden ett pris går inte att följa på en fakturerad rad — priset är låst.
  it('ger inget omöjligt råd om en låst rad', () => {
    expect(workOrderLineItemWarnings([legacy], { ...base, savedRows: [legacy], lockedIds: new Set(['old']) })).toEqual([]);
  });

  it('varnar för en orörd rad vars arbetskostnad äter A-priset när ROT är på', () => {
    const row = { id: 'r', article_name: 'Lösull', pricing_mode: 'item', quantity: '1', unit_price: '500', labor_cost: '700' };
    expect(workOrderLineItemWarnings([row], { rotEnabled: true, savedRows: [row] })[0]).toMatch(/arbetskostnaden äter hela A-priset/);
    expect(workOrderLineItemWarnings([row], { rotEnabled: false, savedRows: [row] })).toEqual([]);
  });

  // Delfakturering proportionerar inte utbrutet ROT-arbete (hasCarvedRotLabor) — nästa runda stoppas.
  it('varnar när en delfakturerad ROT-order får en utbruten arbetskostnad', () => {
    const row = { id: 'r', article_name: 'Lösull', pricing_mode: 'item', quantity: '2', unit_price: '500', labor_cost: '200' };
    expect(workOrderLineItemWarnings([row], { rotEnabled: true, savedRows: [], partiallyInvoiced: true }).join(' ')).toMatch(/stoppar nästa delfaktura/);
    expect(workOrderLineItemWarnings([row], { rotEnabled: true, savedRows: [], partiallyInvoiced: false })).toEqual([]);
  });

  it('tiger när allt är i ordning', () => {
    const ok = { ...legacy, unit_price: '500' };
    expect(workOrderLineItemWarnings([ok], { ...base, savedRows: [ok] })).toEqual([]);
  });
});
