import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Tokenkedjan mot Fortnox (lib/domains/fortnox/client.ts). Fortnox regler, uppmätta mot testbolaget 2026-10-01:
// en refresh-token går att använda EN gång (återanvänd → 400 invalid_grant direkt), tokenen den första förnyelsen gav
// lever vidare, och den gamla access-tokenen gäller till sin utgång. MEN två förnyelser i exakt samma ögonblick får båda
// nya tokens, och bara det senast utdelade paret gäller. Kedjan bröts i testmiljön samma dag (databasen låg kvar med en
// förbrukad refresh-token), och samma sak återskapades lokalt med två processer — de här testerna vaktar vägarna dit.

type Row = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  connected_at: string;
  updated_at?: string;
  refresh_claimed_at?: string | null;
};
type DbError = { code?: string; message: string };

const h = vi.hoisted(() => {
  const db = {
    row: null as Row | null,
    reads: 0,
    updates: 0,
    onRead: undefined as undefined | ((read: number) => void),
    // Körs efter att läsningen tagit sin kopia: en annan instans som sparar mellan vår läsning och vår ändring.
    afterRead: undefined as undefined | ((read: number) => void),
    readErrors: [] as DbError[],
    // Fel på anspråket (en ändring som bara stämplar refresh_claimed_at). `then` körs när felet ges.
    claimErrors: [] as { error: DbError; then?: () => void }[],
    // Fel på sparandet av en förnyad token (en ändring som skriver refresh_token).
    persistErrors: [] as DbError[],
    // Före migreringen: PostgREST nekar kolumnen i kroppen (PGRST204) och i ett filter (42703).
    claimColumnMissing: false,
  };
  type Filter = (row: Row) => boolean;
  const table = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          db.reads++;
          const error = db.readErrors.shift();
          if (error) return { data: null, error };
          db.onRead?.(db.reads);
          const data = db.row ? { ...db.row } : null;
          db.afterRead?.(db.reads);
          return { data, error: null };
        },
      }),
    }),
    update: (patch: Partial<Row>) => {
      const filters: Filter[] = [];
      const filterColumns = new Set<string>();
      const query = {
        eq: (column: keyof Row | 'provider', value: string) => {
          if (column !== 'provider') filters.push((row) => row[column] === value);
          filterColumns.add(column);
          return query;
        },
        is: (column: keyof Row, value: null) => {
          filters.push((row) => (row[column] ?? null) === value);
          filterColumns.add(column);
          return query;
        },
        lt: (column: keyof Row, value: string) => {
          filters.push((row) => row[column] != null && String(row[column]) < value);
          filterColumns.add(column);
          return query;
        },
        select: async () => {
          db.updates++;
          if (db.claimColumnMissing && 'refresh_claimed_at' in patch) {
            return { data: null, error: { code: 'PGRST204', message: "Could not find the 'refresh_claimed_at' column" } };
          }
          if (db.claimColumnMissing && filterColumns.has('refresh_claimed_at')) {
            return { data: null, error: { code: '42703', message: 'column refresh_claimed_at does not exist' } };
          }
          if (patch.refresh_claimed_at && !('refresh_token' in patch)) {
            const failure = db.claimErrors.shift();
            if (failure) {
              failure.then?.();
              return { data: null, error: failure.error };
            }
          }
          if ('refresh_token' in patch) {
            const error = db.persistErrors.shift();
            if (error) return { data: null, error };
          }
          const row = db.row;
          if (!row || !filters.every((f) => f(row))) return { data: [], error: null };
          db.row = { ...row, ...patch };
          return { data: [{ id: 'fortnox' }], error: null };
        },
      };
      return query;
    },
  });
  return { db, admin: { from: () => table() }, waitUntil: vi.fn() };
});

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdminUncached: () => h.admin }));
vi.mock('@vercel/functions', () => ({ waitUntil: h.waitUntil }));

const NOW = new Date('2026-10-01T12:00:00Z');
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();
const CONNECTED = inMinutes(-24 * 60);

// Klienten bär tillstånd i modulen (förnyelsen som pågår, en känd död token): en ny modul i varje test.
let c: typeof import('@/lib/domains/fortnox/client');

type TokenReply = { status: number; body: unknown; before?: () => void };
let tokenReplies: TokenReply[] = [];
let tokenCalls: RequestInit[] = [];
let apiBearers: string[] = [];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.resetModules();
  c = await import('@/lib/domains/fortnox/client');
  h.db.row = { access_token: 'AT0', refresh_token: 'RT0', expires_at: inMinutes(-10), connected_at: CONNECTED, refresh_claimed_at: null };
  h.db.reads = 0;
  h.db.updates = 0;
  h.db.onRead = undefined;
  h.db.afterRead = undefined;
  h.db.readErrors = [];
  h.db.claimErrors = [];
  h.db.persistErrors = [];
  h.db.claimColumnMissing = false;
  h.waitUntil.mockClear();
  tokenReplies = [];
  tokenCalls = [];
  apiBearers = [];
  vi.stubEnv('FORTNOX_CLIENT_ID', 'id');
  vi.stubEnv('FORTNOX_CLIENT_SECRET', 'secret');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === c.FORTNOX_TOKEN_URL) {
        tokenCalls.push(init);
        const reply = tokenReplies.shift();
        if (!reply) throw new Error('oväntad förnyelse');
        reply.before?.();
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }
      apiBearers.push(new Headers(init.headers).get('authorization') ?? '');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const rotated = (n: number, before?: () => void): TokenReply => ({
  status: 200,
  body: { access_token: `AT${n}`, refresh_token: `RT${n}`, expires_in: 3600, scope: 'x', token_type: 'bearer' },
  before,
});
const invalidGrant: TokenReply = { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid refresh token' } };
// En annan instans har sparat sin förnyade token.
const savedElsewhere = (n: number): Row => ({
  access_token: `AT${n}`,
  refresh_token: `RT${n}`,
  expires_at: inMinutes(60 - n / 100),
  connected_at: CONNECTED,
  refresh_claimed_at: null,
});

// Kör ett anrop till slut genom alla väntetider. Felet fångas direkt så att det aldrig blir ett ohanterat avslag.
async function settle<T>(call: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  const outcome = call.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync();
  return outcome;
}

describe('Fortnox-tokenen', () => {
  it('använder den sparade tokenen så länge den gäller', async () => {
    h.db.row = { ...h.db.row!, expires_at: inMinutes(30) };
    await settle(c.fortnoxGet('/settings/company'));
    expect(tokenCalls).toHaveLength(0);
    expect(apiBearers).toEqual(['Bearer AT0']);
  });

  it('tar anspråket, förnyar, sparar och håller instansen vid liv', async () => {
    let claimedDuringCall: string | null | undefined;
    tokenReplies = [rotated(1, () => (claimedDuringCall = h.db.row?.refresh_claimed_at))];
    const { error } = await settle(c.fortnoxGet('/settings/company'));

    expect(error).toBeUndefined();
    expect(claimedDuringCall).toBe(NOW.toISOString());
    // Sparad, och anspråket nollat av den som tog det.
    expect(h.db.row).toMatchObject({ access_token: 'AT1', refresh_token: 'RT1', expires_at: inMinutes(60), refresh_claimed_at: null });
    expect(apiBearers).toEqual(['Bearer AT1']);
    // Ett cachat svar från token-ändpunkten vore en refresh-token som Fortnox redan förbrukat, och ett anrop som hänger
    // får inte överleva anspråket.
    expect(tokenCalls[0].cache).toBe('no-store');
    expect(tokenCalls[0].signal).toBeInstanceOf(AbortSignal);
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
  });

  // Anspråket i databasen hade också stoppat en andra förnyelse, men då genom att läsa om raden var 250:e ms. I samma
  // process väntar den andra på samma löfte: två läsningar i getValidAccessToken, en i refreshAndPersist.
  it('förnyar en gång per process, och den andra anroparen väntar på samma förnyelse', async () => {
    tokenReplies = [rotated(1)];
    const { error } = await settle(Promise.all([c.fortnoxGet('/a'), c.fortnoxGet('/b')]));
    expect(error).toBeUndefined();
    expect(tokenCalls).toHaveLength(1);
    expect(h.db.reads).toBe(3);
    expect(apiBearers).toEqual(['Bearer AT1', 'Bearer AT1']);
  });

  describe('anspråket mellan instanserna', () => {
    // Det som bröt kedjan: två instanser som förnyar i samma ögonblick får BÅDA nya tokens, men bara det senast
    // utdelade paret gäller. Den som inte får anspråket går aldrig själv till Fortnox, utan väntar in den andras token.
    it('väntar in en annan instans som håller anspråket och använder dess token', async () => {
      h.db.row = { ...h.db.row!, refresh_claimed_at: NOW.toISOString() };
      // Läsning 1 = getValidAccessToken, 2 och 3 = anspråket hålls, 4 = den andra har sparat.
      h.db.onRead = (read) => {
        if (read === 4) h.db.row = savedElsewhere(1);
      };
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeUndefined();
      expect(tokenCalls).toHaveLength(0);
      // Ett färskt anspråk prövas inte ens: väntan är bara läsningar.
      expect(h.db.updates).toBe(0);
      expect(apiBearers).toEqual(['Bearer AT1']);
    });

    // Anspråket tas bara på den version vi läste. Har en annan instans hunnit spara mellan läsningen och anspråket hade
    // ett anspråk på RADEN skickat den redan förbrukade tokenen till Fortnox.
    it('läser om i stället för att förnya när någon sparade mellan läsningen och anspråket', async () => {
      h.db.afterRead = (read) => {
        if (read === 2) h.db.row = savedElsewhere(1);
      };
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeUndefined();
      expect(tokenCalls).toHaveLength(0);
      expect(apiBearers).toEqual(['Bearer AT1']);
    });

    it('tar över ett anspråk som övergivits', async () => {
      tokenReplies = [rotated(1)];
      h.db.row = { ...h.db.row!, refresh_claimed_at: inMinutes(-0.5) };
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeUndefined();
      expect(tokenCalls).toHaveLength(1);
      expect(h.db.row?.refresh_token).toBe('RT1');
    });

    it('ger upp när en annan instans aldrig blir klar', async () => {
      // Anspråket förnyas hela tiden: det blir aldrig övergivet.
      h.db.onRead = () => {
        if (h.db.row) h.db.row.refresh_claimed_at = new Date().toISOString();
      };
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeInstanceOf(c.FortnoxApiError);
      expect((error as InstanceType<typeof c.FortnoxApiError>).status).toBe(503);
      expect(tokenCalls).toHaveLength(0);
    });

    // Ett fel på anspråket är inget vunnet anspråk: att förnya ändå är just två förnyelser samtidigt.
    it('förnyar inte utan lås efter ett tillfälligt fel på anspråket', async () => {
      h.db.claimErrors = [{ error: { code: 'PGRST000', message: 'tillfälligt' }, then: () => (h.db.row = savedElsewhere(1)) }];
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeUndefined();
      expect(tokenCalls).toHaveLength(0);
      expect(apiBearers).toEqual(['Bearer AT1']);
    });

    // Koden kan nå prod före migreringen. Då ska den förnya som förut, inte stänga ute Fortnox — och sparandet får inte
    // nämna kolumnen.
    it('förnyar som förut, utan lås, när kolumnen inte finns än', async () => {
      tokenReplies = [rotated(1)];
      const { refresh_claimed_at: _absent, ...withoutColumn } = h.db.row!;
      h.db.row = withoutColumn;
      h.db.claimColumnMissing = true;
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeUndefined();
      expect(h.db.row?.refresh_token).toBe('RT1');
      expect(apiBearers).toEqual(['Bearer AT1']);
    });

    it('släpper sitt anspråk när förnyelsen misslyckas', async () => {
      tokenReplies = [{ status: 503, body: { error: 'temporarily_unavailable' } }];
      await settle(c.fortnoxGet('/settings/company'));
      expect(h.db.row?.refresh_claimed_at).toBeNull();
    });

    // Höll vi anspråket för länge och någon tog över är det deras nu: att nolla det släpper in en tredje.
    it('släpper aldrig någon annans anspråk', async () => {
      const theirs = inMinutes(0.4);
      tokenReplies = [{ status: 503, body: { error: 'temporarily_unavailable' }, before: () => (h.db.row!.refresh_claimed_at = theirs) }];
      await settle(c.fortnoxGet('/settings/company'));
      expect(h.db.row?.refresh_claimed_at).toBe(theirs);
    });
  });

  describe('när Fortnox nekar refresh-tokenen', () => {
    // Utan anspråket (en instans med den gamla koden under en deploy): Fortnox nekar den andra (~0,2 s) innan den första
    // ens fått svar (~0,7 s). Den andra ska vänta in den förstas sparande, inte kasta "Något gick fel mot Fortnox".
    it('tar den token en annan instans sparade', async () => {
      tokenReplies = [invalidGrant];
      // Läsning 1 = getValidAccessToken, 2 = refreshAndPersist, 3 = första omläsningen (efter 250 ms), 4 = efter 750 ms.
      h.db.onRead = (read) => {
        if (read === 4) h.db.row = savedElsewhere(1);
      };
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeUndefined();
      expect(apiBearers).toEqual(['Bearer AT1']);
    });

    it('säger att kopplingen måste göras om när ingen sparar en ny token', async () => {
      tokenReplies = [invalidGrant];
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeInstanceOf(c.FortnoxConnectionExpiredError);
      // Varje ställe som redan fångar Fortnox-fel ska fortsätta göra det, och ett 400 hade betytt "dokumentet är fel"
      // (storeOrderFortnoxFailure gör då inga omförsök).
      expect(error).toBeInstanceOf(c.FortnoxApiError);
      expect((error as InstanceType<typeof c.FortnoxApiError>).status).toBe(503);
      expect(c.friendlyFortnoxMessage(error)).toContain('koppla från och ansluta Fortnox igen');
      expect(apiBearers).toHaveLength(0);
      expect(h.db.row?.refresh_token).toBe('RT0');
    });

    // En bruten kedja hade annars kostat varje anrop ~6 s (anspråk, Fortnox, omläsningar) innan det föll.
    it('faller direkt nästa gång, tills någon kopplar om', async () => {
      tokenReplies = [invalidGrant];
      await settle(c.fortnoxGet('/a'));

      const again = await settle(c.fortnoxGet('/b'));
      expect(again.error).toBeInstanceOf(c.FortnoxConnectionExpiredError);
      expect(tokenCalls).toHaveLength(1);

      tokenReplies = [rotated(2)];
      h.db.row = { ...savedElsewhere(9), access_token: 'ATny', refresh_token: 'RTny', expires_at: inMinutes(-10), connected_at: NOW.toISOString() };
      const reconnected = await settle(c.fortnoxGet('/c'));
      expect(reconnected.error).toBeUndefined();
      expect(tokenCalls).toHaveLength(2);
    });

    it('väntar inte på någon annan instans vid andra förnyelsefel', async () => {
      tokenReplies = [{ status: 500, body: { error: 'server_error' } }];
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeInstanceOf(c.FortnoxApiError);
      expect(error).not.toBeInstanceOf(c.FortnoxConnectionExpiredError);
      expect(h.db.reads).toBe(2);
    });
  });

  describe('sparandet', () => {
    // Fortnox har redan förbrukat RT0 när sparandet görs. Tappas det ligger kedjan död i databasen.
    it('gör om ett sparande som misslyckas', async () => {
      tokenReplies = [rotated(1)];
      h.db.persistErrors = [{ message: 'PGRST002' }];
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeUndefined();
      expect(h.db.row?.refresh_token).toBe('RT1');
    });

    it('lämnar en ny koppling orörd om någon kopplade om under förnyelsen', async () => {
      const reconnect: Row = { access_token: 'ATny', refresh_token: 'RTny', expires_at: inMinutes(60), connected_at: NOW.toISOString(), refresh_claimed_at: null };
      tokenReplies = [rotated(1, () => (h.db.row = reconnect))];
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeUndefined();
      expect(h.db.row?.refresh_token).toBe('RTny');
      // Vår access-token gäller ändå; Fortnox drar inte in den.
      expect(apiBearers).toEqual(['Bearer AT1']);
    });

    // Två förnyelser av samma token (en instans utan anspråket): Fortnox godtar bara det senast utdelade paret, och vårt
    // svar kom efter den andras sparande. Först skriven vinner hade sparat det döda — det hände i provet 2026-10-01.
    it('skriver över en annan förnyelse av samma token som hann spara först', async () => {
      tokenReplies = [rotated(1, () => (h.db.row = savedElsewhere(7)))];
      const { error } = await settle(c.fortnoxGet('/settings/company'));

      expect(error).toBeUndefined();
      expect(h.db.row?.refresh_token).toBe('RT1');
    });
  });

  // Ett läsfel hade tidigare blivit "Fortnox är inte kopplat", och anropare som tyst hoppar över en push vid det hade
  // tappat den.
  it('ett läsfel är inte "inte kopplat"', async () => {
    h.db.readErrors = [{ message: 'connection reset' }];
    const { error } = await settle(c.fortnoxGet('/settings/company'));

    expect(error).not.toBeInstanceOf(c.FortnoxNotConnectedError);
    expect((error as Error).message).toContain('connection reset');
  });
});
