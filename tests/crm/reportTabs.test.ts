import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REPORT_TAB,
  periodChipLabel,
  resolveReportTab,
  visibleReportTabs,
} from '@/app/crm/rapportering/reportTabs';

describe('visibleReportTabs', () => {
  it('🔴 Tid syns bara när rutten lämnat ut tiden', () => {
    // Fliken uteblir helt — den får inte stå där och skylta med att något döljs.
    expect(visibleReportTabs({ hasTime: false }).map((t) => t.id)).not.toContain('tid');
    expect(visibleReportTabs({ hasTime: true }).map((t) => t.id)).toContain('tid');
  });

  it('flikarna står i specens ordning', () => {
    expect(visibleReportTabs({ hasTime: true }).map((t) => t.id)).toEqual([
      'oversikt', 'forsaljning', 'omsattning', 'produkt', 'produktion', 'tid',
    ]);
  });

  it('Produkt & marknad syns för alla som ser rapporten', () => {
    expect(visibleReportTabs({ hasTime: false }).map((t) => t.id)).toContain('produkt');
  });
});

describe('resolveReportTab', () => {
  const salesTabs = visibleReportTabs({ hasTime: false });

  it('följer ?flik= till en flik läsaren har', () => {
    expect(resolveReportTab('omsattning', salesTabs)).toBe('omsattning');
  });

  it('🔴 en länk till Tid landar på Översikt för den som inte får se tiden', () => {
    expect(resolveReportTab('tid', salesTabs)).toBe(DEFAULT_REPORT_TAB);
  });

  it('okänt eller saknat värde ger förvalet', () => {
    expect(resolveReportTab('nonsens', salesTabs)).toBe('oversikt');
    expect(resolveReportTab(null, salesTabs)).toBe('oversikt');
  });
});

describe('periodChipLabel', () => {
  it('hel månad: bara månaden', () => {
    expect(periodChipLabel({ from: '2026-09-01', to: '2026-09-30' }, 2026)).toBe('sep');
    expect(periodChipLabel({ from: '2028-02-01', to: '2028-02-29' }, 2026)).toBe('feb 2028');
  });

  it('del av en månad: dagarna', () => {
    expect(periodChipLabel({ from: '2026-10-01', to: '2026-10-07' }, 2026)).toBe('1–7 okt');
    expect(periodChipLabel({ from: '2026-10-07', to: '2026-10-07' }, 2026)).toBe('7 okt');
  });

  it('över ett månadsskifte', () => {
    expect(periodChipLabel({ from: '2026-09-28', to: '2026-10-04' }, 2026)).toBe('28 sep–4 okt');
    expect(periodChipLabel({ from: '2026-01-01', to: '2026-09-30' }, 2026)).toBe('jan–sep');
  });

  it('över ett årsskifte skriver ut båda åren', () => {
    expect(periodChipLabel({ from: '2025-11-01', to: '2026-10-07' }, 2026)).toBe('1 nov 2025–7 okt 2026');
  });

  it('året skrivs ut för en period i ett annat år', () => {
    expect(periodChipLabel({ from: '2025-03-03', to: '2025-03-09' }, 2026)).toBe('3–9 mar 2025');
  });
});
