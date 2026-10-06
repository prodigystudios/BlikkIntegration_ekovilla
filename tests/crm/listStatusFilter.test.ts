import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QUOTE_STATUS_FILTER,
  DEFAULT_WORK_ORDER_STATUS_FILTER,
  QUOTE_STATUS_FILTER_OPTIONS,
  WORK_ORDER_STATUS_FILTER_OPTIONS,
  isStatusFilterChanged,
  parseStatusFilterParam,
  statusFilterParam,
  summarizeStatusFilter,
  workOrderStatusesFor,
} from '@/lib/domains/crm/listStatusFilter';

// Statusfiltret i offert- och orderlistan (William 2026-10-06): kryssrutor i stället för flikar,
// med allt utom det avslutade ikryssat från start.

const quoteLabel = (status: string) => ({ draft: 'Utkast', sent: 'Skickad', follow_up: 'Följ upp', won: 'Vunnen', lost: 'Förlorad' })[status] ?? status;
const orderLabel = (status: string) => ({
  draft: 'Ej planerad', scheduled: 'Planerad', in_progress: 'Pågående', completed: 'Fakturera',
  partially_invoiced: 'Delfakturerad', invoiced: 'Avslutad', cancelled: 'Avbruten',
})[status] ?? status;

describe('startvalet', () => {
  it('ordrarna: allt utom Avslutad och Avbruten', () => {
    expect(WORK_ORDER_STATUS_FILTER_OPTIONS.filter((o) => !DEFAULT_WORK_ORDER_STATUS_FILTER.includes(o)))
      .toEqual(['invoiced', 'cancelled']);
  });

  it('offerterna: allt utom Förlorad — vunna syns (Williams val)', () => {
    expect(QUOTE_STATUS_FILTER_OPTIONS.filter((o) => !DEFAULT_QUOTE_STATUS_FILTER.includes(o)))
      .toEqual(['lost']);
  });
});

describe('workOrderStatusesFor', () => {
  it('Planerad täcker också den pensionerade ready, som visas som Planerad', () => {
    // Utan den hade varje gammal ready-order fallit bort ur alla urval utom "alla".
    expect(workOrderStatusesFor(['scheduled'])).toEqual(['scheduled', 'ready']);
  });

  it('varje annat val är sin egen status', () => {
    expect(workOrderStatusesFor(['draft', 'invoiced', 'cancelled'])).toEqual(['draft', 'invoiced', 'cancelled']);
  });

  it('startvalet når aldrig avslutade eller avbrutna ordrar', () => {
    const statuses = workOrderStatusesFor(DEFAULT_WORK_ORDER_STATUS_FILTER);
    expect(statuses).not.toContain('invoiced');
    expect(statuses).not.toContain('cancelled');
    expect(statuses).toContain('ready');
  });
});

describe('statusFilterParam', () => {
  it('allt valt → ingen parameter, så att "alla statusar" betyder alla rader', () => {
    expect(statusFilterParam([...QUOTE_STATUS_FILTER_OPTIONS], QUOTE_STATUS_FILTER_OPTIONS)).toBeNull();
  });

  it('inget valt → tom sträng, som servern läser som "inga rader"', () => {
    expect(statusFilterParam([], QUOTE_STATUS_FILTER_OPTIONS)).toBe('');
  });

  it('ett urval i menyns ordning, oavsett i vilken ordning det kryssades', () => {
    expect(statusFilterParam(['won', 'draft'], QUOTE_STATUS_FILTER_OPTIONS)).toBe('draft,won');
  });
});

describe('parseStatusFilterParam', () => {
  it('ingen parameter → inget statusfilter', () => {
    expect(parseStatusFilterParam(undefined, QUOTE_STATUS_FILTER_OPTIONS)).toBeUndefined();
  });

  it('tom parameter → tom lista (inte "inget filter")', () => {
    expect(parseStatusFilterParam('', QUOTE_STATUS_FILTER_OPTIONS)).toEqual([]);
  });

  it('läser en lista och lägger den i menyns ordning', () => {
    expect(parseStatusFilterParam('won, draft', QUOTE_STATUS_FILTER_OPTIONS)).toEqual(['draft', 'won']);
  });

  it('ett okänt värde ger null — rutten svarar 400 i stället för att tyst tappa valet', () => {
    expect(parseStatusFilterParam('draft,ready', QUOTE_STATUS_FILTER_OPTIONS)).toBeNull();
    // `ready` är en status, inte ett val — orderns filter tar den bara via Planerad.
    expect(parseStatusFilterParam('ready', WORK_ORDER_STATUS_FILTER_OPTIONS)).toBeNull();
  });

  it('parametern och läsningen går runt utan förlust', () => {
    const picked = ['in_progress', 'draft', 'cancelled'] as const;
    const param = statusFilterParam(picked, WORK_ORDER_STATUS_FILTER_OPTIONS);
    expect(parseStatusFilterParam(param ?? undefined, WORK_ORDER_STATUS_FILTER_OPTIONS)).toEqual(['draft', 'in_progress', 'cancelled']);
  });
});

describe('summarizeStatusFilter — filterknappens text', () => {
  it('startvalen läses som det de är', () => {
    expect(summarizeStatusFilter(DEFAULT_QUOTE_STATUS_FILTER, QUOTE_STATUS_FILTER_OPTIONS, quoteLabel)).toBe('Utom Förlorad');
    expect(summarizeStatusFilter(DEFAULT_WORK_ORDER_STATUS_FILTER, WORK_ORDER_STATUS_FILTER_OPTIONS, orderLabel)).toBe('Utom Avslutad, Avbruten');
  });

  it('allt, inget och en enda', () => {
    expect(summarizeStatusFilter([...QUOTE_STATUS_FILTER_OPTIONS], QUOTE_STATUS_FILTER_OPTIONS, quoteLabel)).toBe('Alla statusar');
    expect(summarizeStatusFilter([], QUOTE_STATUS_FILTER_OPTIONS, quoteLabel)).toBe('Ingen status');
    expect(summarizeStatusFilter(['follow_up'], QUOTE_STATUS_FILTER_OPTIONS, quoteLabel)).toBe('Följ upp');
  });

  it('fler än två urkryssade → antalet valda', () => {
    expect(summarizeStatusFilter(['draft', 'sent'], QUOTE_STATUS_FILTER_OPTIONS, quoteLabel)).toBe('2 statusar');
  });
});

describe('isStatusFilterChanged', () => {
  it('startvalet räknas inte som ett aktivt filter, i vilken ordning det än står', () => {
    expect(isStatusFilterChanged([...DEFAULT_QUOTE_STATUS_FILTER].reverse(), DEFAULT_QUOTE_STATUS_FILTER)).toBe(false);
  });

  it('ett tillagt eller borttaget val gör det', () => {
    expect(isStatusFilterChanged([...DEFAULT_QUOTE_STATUS_FILTER, 'lost'], DEFAULT_QUOTE_STATUS_FILTER)).toBe(true);
    expect(isStatusFilterChanged(['draft'], DEFAULT_QUOTE_STATUS_FILTER)).toBe(true);
  });
});
