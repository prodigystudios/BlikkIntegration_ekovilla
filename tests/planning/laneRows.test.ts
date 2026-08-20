import { describe, it, expect } from 'vitest';
import { packRows } from '@/app/crm/planering/laneRows';

// Regressionsvakt: korten placerades förr av gridens egen autoplacering, som bara flyttar markören
// framåt. Tisdagens kort ärvde då raden där måndagens sista kort slutade och tavlan blev en trappa.
describe('packRows', () => {
  it('staplar varje dag uppifrån i stället för att ärva föregående dags rad', () => {
    // Två jobb på måndag, två på tisdag, ett på onsdag, ett på torsdag.
    const spans = [{ s: 0, e: 0 }, { s: 0, e: 0 }, { s: 1, e: 1 }, { s: 1, e: 1 }, { s: 2, e: 2 }, { s: 3, e: 3 }];
    expect(packRows(spans, 5)).toEqual([1, 2, 1, 2, 1, 1]);
  });

  it('låter ett flerdagarskort blockera raden på alla dagar det spänner över', () => {
    // mån–ons på rad 1 → tisdagskortet och första onsdagskortet får rad 2, nästa onsdagskort rad 3.
    const spans = [{ s: 0, e: 2 }, { s: 1, e: 1 }, { s: 2, e: 2 }, { s: 2, e: 2 }];
    expect(packRows(spans, 5)).toEqual([1, 2, 2, 3]);
  });

  it('behåller dagens ordning uppifrån och ner även när dagen är full', () => {
    const spans = [{ s: 2, e: 2 }, { s: 2, e: 2 }, { s: 2, e: 2 }];
    expect(packRows(spans, 7)).toEqual([1, 2, 3]);
  });

  it('ger dolda kort en rad utan att ta plats, så indexen följer segmentlistan', () => {
    expect(packRows([null, { s: 4, e: 4 }, null, { s: 4, e: 4 }], 5)).toEqual([1, 1, 1, 2]);
  });

  it('återanvänder en rad så snart spannen inte överlappar', () => {
    expect(packRows([{ s: 0, e: 1 }, { s: 2, e: 3 }, { s: 1, e: 2 }], 5)).toEqual([1, 1, 2]);
  });
})
