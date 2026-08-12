import { describe, it, expect } from 'vitest';
import {
  canTransition,
  isDateInPeriod,
  isPeriodLocked,
  normalizeOverviewRow,
  periodLabel,
  periodLockError,
  periodRange,
  periodStartOf,
  statusOf,
  TIME_PERIOD_STATUSES,
  type TimePeriodStatus,
} from '@/lib/domains/time/approvals';

// Attest (fas 4.4). Två saker prövas här:
//
//   1. PERIODMATTEN. Kalendermånad, räknad på strängar. Det låter trivialt tills en Date passerar
//      förbi och lägger en rad i fel månad vid varje månadsskifte.
//   2. ÖVERGÅNGSMATRISEN. Den finns på två ställen — här och i set_time_period_status() i
//      20260812_time_approvals.sql. Testet beskriver den i ord så att den som ändrar den ena kan se
//      vad den andra måste säga.

describe('periodStartOf', () => {
  it('tar en månad', () => {
    expect(periodStartOf('2026-08')).toBe('2026-08-01');
  });

  it('tar ett datum och drar det till månadens början', () => {
    expect(periodStartOf('2026-08-14')).toBe('2026-08-01');
    expect(periodStartOf('2026-08-31')).toBe('2026-08-01');
  });

  it('kastar på skräp i stället för att gissa en period', () => {
    expect(() => periodStartOf('augusti')).toThrow();
    expect(() => periodStartOf('2026/08')).toThrow();
    expect(() => periodStartOf('')).toThrow();
  });

  it('kastar på en månad utanför 01–12 i stället för att bygga ett omöjligt datum', () => {
    // '2026-13' matchar \d{2} och hade blivit '2026-13-01' — ett datum Postgres avvisar med 22008,
    // alltså ett 500 långt från felets orsak. Mönstret ska fånga det, inte databasen.
    expect(() => periodStartOf('2026-13')).toThrow();
    expect(() => periodStartOf('2026-00')).toThrow();
    expect(() => periodStartOf('2026-99')).toThrow();
    expect(() => periodStartOf('2026-13-01')).toThrow();
  });

  it('går inte via Date — sista dagen i månaden hamnar inte i nästa', () => {
    // new Date('2026-08-31') är UTC-midnatt, vilket i svensk tid är samma dag men i t.ex. UTC-5
    // blir 30 augusti. Strängvägen har inte problemet alls, och det är hela poängen.
    expect(periodStartOf('2026-01-31')).toBe('2026-01-01');
    expect(periodStartOf('2026-12-31')).toBe('2026-12-01');
  });
});

describe('periodRange', () => {
  it('ger månadens första och sista dag', () => {
    expect(periodRange('2026-08-01')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(periodRange('2026-04-01')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });

  it('klarar februari, inklusive skottår', () => {
    expect(periodRange('2026-02-01').to).toBe('2026-02-28');
    expect(periodRange('2028-02-01').to).toBe('2028-02-29');
  });

  it('kastar på en periodstart som inte är ett datum', () => {
    expect(() => periodRange('2026-08')).toThrow();
  });
});

describe('periodLabel', () => {
  it('skriver månaden på svenska', () => {
    expect(periodLabel('2026-08-01')).toBe('augusti 2026');
    expect(periodLabel('2026-01-01')).toBe('januari 2026');
    expect(periodLabel('2026-12-01')).toBe('december 2026');
  });
});

describe('isDateInPeriod', () => {
  it('täcker hela månaden, inklusive första och sista dagen', () => {
    expect(isDateInPeriod('2026-08-01', '2026-08-01')).toBe(true);
    expect(isDateInPeriod('2026-08-01', '2026-08-31')).toBe(true);
    expect(isDateInPeriod('2026-08-01', '2026-07-31')).toBe(false);
    expect(isDateInPeriod('2026-08-01', '2026-09-01')).toBe(false);
  });
});

describe('isPeriodLocked', () => {
  it('låser på BÅDE inlämnad och attesterad', () => {
    // `submitted` måste låsa: annars kan någon ändra i underlaget medan granskningen pågår, och
    // granskaren attesterar något annat än det hen tittade på.
    expect(isPeriodLocked('submitted')).toBe(true);
    expect(isPeriodLocked('approved')).toBe(true);
  });

  it('låser inte en öppen period, och inte ett saknat tillstånd', () => {
    expect(isPeriodLocked('open')).toBe(false);
    expect(isPeriodLocked(null)).toBe(false);
    expect(isPeriodLocked(undefined)).toBe(false);
  });
});

describe('statusOf', () => {
  it('läser ingen rad som öppen period', () => {
    // Raden skapas först vid första övergången — en person som aldrig lämnat in har inga rader.
    expect(statusOf(null)).toBe('open');
    expect(statusOf(undefined)).toBe('open');
    expect(statusOf({ status: 'approved' })).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// Övergångsmatrisen
// ---------------------------------------------------------------------------

const SELF = { isSelf: true, canApprove: false };
const SELF_ADMIN = { isSelf: true, canApprove: true };
const OTHER = { isSelf: false, canApprove: false };
const OTHER_ADMIN = { isSelf: false, canApprove: true };

describe('canTransition — den anställde', () => {
  it('lämnar in sin egen öppna period', () => {
    expect(canTransition('open', 'submitted', SELF).allowed).toBe(true);
  });

  it('får ångra sin inlämning så länge den inte attesterats', () => {
    // Williams beslut 2026-08-12: självbetjäning fram till attest sparar ett telefonsamtal varje
    // gång någon trycker fel.
    expect(canTransition('submitted', 'open', SELF).allowed).toBe(true);
  });

  it('får INTE öppna en attesterad period', () => {
    const result = canTransition('approved', 'open', SELF);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toMatch(/attestansvarig/i);
  });

  it('får INTE attestera sig själv', () => {
    const result = canTransition('submitted', 'approved', SELF);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toMatch(/behörighet/i);
  });

  it('kan inte lämna in en redan attesterad period', () => {
    expect(canTransition('approved', 'submitted', SELF).allowed).toBe(false);
  });
});

describe('canTransition — attestansvarig', () => {
  it('attesterar en inlämnad period', () => {
    expect(canTransition('submitted', 'approved', OTHER_ADMIN).allowed).toBe(true);
  });

  it('attesterar direkt från öppen', () => {
    // Beslut 3: lönen måste kunna köras även för den som är sjuk, slutat eller glömt knappen.
    expect(canTransition('open', 'approved', OTHER_ADMIN).allowed).toBe(true);
  });

  it('öppnar både inlämnad och attesterad period', () => {
    expect(canTransition('submitted', 'open', OTHER_ADMIN).allowed).toBe(true);
    expect(canTransition('approved', 'open', OTHER_ADMIN).allowed).toBe(true);
  });

  it('kan INTE lämna in åt någon annan', () => {
    // Inlämningen är den anställdes intygande om att månaden är färdig. Den går inte att göra åt
    // någon — behöver admin stänga månaden ändå är vägen attest, inte en inlämning i annans namn.
    const result = canTransition('open', 'submitted', OTHER_ADMIN);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toMatch(/den anställde/i);
  });
});

describe('canTransition — utomstående', () => {
  it('får inte röra någon annans period alls', () => {
    expect(canTransition('open', 'submitted', OTHER).allowed).toBe(false);
    expect(canTransition('submitted', 'approved', OTHER).allowed).toBe(false);
    expect(canTransition('submitted', 'open', OTHER).allowed).toBe(false);
    expect(canTransition('approved', 'open', OTHER).allowed).toBe(false);
  });
});

describe('canTransition — samma status', () => {
  it('är en no-op för alla, inte ett fel', () => {
    // Dubbelklick och en långsam uppkoppling ska inte ge ett rött meddelande om något som redan
    // är sant.
    for (const status of TIME_PERIOD_STATUSES) {
      for (const actor of [SELF, SELF_ADMIN, OTHER, OTHER_ADMIN]) {
        expect(canTransition(status, status, actor).allowed).toBe(true);
      }
    }
  });
});

describe('canTransition — matrisen är fullständig', () => {
  it('täcker varje kombination utan att kasta', () => {
    // Vaktar mot en framtida status som glöms i en gren och tyst faller igenom till "tillåtet".
    for (const from of TIME_PERIOD_STATUSES) {
      for (const to of TIME_PERIOD_STATUSES) {
        for (const actor of [SELF, SELF_ADMIN, OTHER, OTHER_ADMIN]) {
          const result = canTransition(from as TimePeriodStatus, to as TimePeriodStatus, actor);
          expect(typeof result.allowed).toBe('boolean');
          if (!result.allowed) expect(result.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Svarsformer
// ---------------------------------------------------------------------------

describe('normalizeOverviewRow', () => {
  it('gör om PostgREST:s strängar till siffror', () => {
    // numeric och stora bigint kommer tillbaka som STRÄNGAR. Utan det här hade '120.50' + '80.25'
    // blivit '120.5080.25' i totalsummeringen — samma fälla som summarizeCompensations redan bär.
    const row = normalizeOverviewRow({
      user_id: 'u1',
      full_name: 'Anna',
      role: 'member',
      status: 'submitted',
      work_minutes: '9600',
      absence_minutes: '480',
      entry_count: '21',
      compensation_amount: '1250.50',
      compensation_count: '3',
    });
    expect(row.work_minutes).toBe(9600);
    expect(row.compensation_amount).toBe(1250.5);
    expect(row.entry_count).toBe(21);
  });

  it('fyller i tomma fält i stället för att lämna undefined', () => {
    const row = normalizeOverviewRow({ user_id: 'u1' });
    expect(row.status).toBe('open');
    expect(row.full_name).toBeNull();
    expect(row.work_minutes).toBe(0);
    expect(row.compensation_amount).toBe(0);
  });
});

describe('periodLockError', () => {
  it('känner igen låstriggerns fel och gör det till 409', () => {
    const mapped = periodLockError({ code: 'P0001', message: 'Perioden är inlämnad eller attesterad och kan inte ändras' });
    expect(mapped).toEqual({
      status: 409,
      code: 'time_period_locked',
      message: 'Perioden är inlämnad eller attesterad och kan inte ändras',
    });
  });

  it('lämnar andra fel ifred', () => {
    expect(periodLockError({ code: '23505', message: 'duplicate key' })).toBeNull();
    expect(periodLockError(null)).toBeNull();
    expect(periodLockError(undefined)).toBeNull();
  });
});
