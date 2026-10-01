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
  updated_at?: string;
  refresh_claimed_at?: string | null;
};

const h = vi.hoisted(() => {
  const db = {
    row: null as Row | null,
    reads: 0,
    onRead: undefined as undefined | ((read: number) => void),
    // Körs efter att läsningen tagit sin kopia: en annan instans som sparar mellan vår läsning och vår ändring.
    afterRead: undefined as undefined | ((read: number) => void),
    // Fel på sparandet av en förnyad token (en ändring som skriver refresh_token).
    persistErrors: [] as string[],
    // Före migreringen: PostgREST nekar varje ändring som nämner kolumnen.
    claimColumnMissing: false,
  };
  type Filter = (row: Row) => boolean;
  const table = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          db.reads++;
          db.onRead?.(db.reads);
          const data = db.row ? { ...db.row } : null;
          db.afterRead?.(db.reads);
          return { data, error: null };
        },
      }),
    }),
    update: (patch: Partial<Row>) => {
      const filters: Filter[] = [];
      const columns = new Set<string>(Object.keys(patch));
      const query = {
        eq: (column: keyof Row | 'provider', value: string) => {
          if (column !== 'provider') filters.push((row) => row[column] === value);
          columns.add(column);
          return query;
        },
        is: (column: keyof Row, value: null) => {
          filters.push((row) => (row[column] ?? null) === value);
          columns.add(column);
          return query;
        },
        lt: (column: keyof Row, value: string) => {
          filters.push((row) => row[column] != null && String(row[column]) < value);
          columns.add(column);
          return query;
        },
        select: async () => {
          if (db.claimColumnMissing && columns.has('refresh_claimed_at')) {
            return { data: null, error: { message: "Could not find the 'refresh_claimed_at' column" } };
          }
          if ('refresh_token' in patch) {
            const error = db.persistErrors.shift();
            if (error) return { data: null, error: { message: error } };
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

import {
  FORTNOX_TOKEN_URL,
  FortnoxApiError,
  FortnoxConnectionExpiredError,
  fortnoxGet,
  friendlyFortnoxMessage,
} from '@/lib/domains/fortnox/client';

const NOW = new Date('2026-10-01T12:00:00Z');
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

type TokenReply = { status: number; body: unknown; before?: () => void };
let tokenReplies: TokenReply[] = [];
let tokenCalls: RequestInit[] = [];
let apiBearers: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.db.row = { access_token: 'AT0', refresh_token: 'RT0', expires_at: inMinutes(-10) };
  h.db.reads = 0;
  h.db.onRead = undefined;
  h.db.afterRead = undefined;
  h.db.persistErrors = [];
  h.db.claimColumnMissing = false;
  h.waitUntil.mockClear();
  tokenReplies = [];
  tokenCalls = [];
  apiBearers = [];
  process.env.FORTNOX_CLIENT_ID = 'id';
  process.env.FORTNOX_CLIENT_SECRET = 'secret';
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === FORTNOX_TOKEN_URL) {
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
  vi.restoreAllMocks();
});

const rotated = (n: number): TokenReply => ({
  status: 200,
  body: { access_token: `AT${n}`, refresh_token: `RT${n}`, expires_in: 3600, scope: 'x', token_type: 'bearer' },
});
const invalidGrant: TokenReply = { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid refresh token' } };

// Kör ett anrop till slut genom alla väntetider. Felet fångas direkt så att det aldrig blir ett ohanterat avslag.
async function settle<T>(call: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  const outcome = call.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync();
  return outcome;
}

describe('Fortnox-tokenen', () => {
  it('använder den sparade tokenen så länge den gäller', async () => {
    h.db.row = { access_token: 'AT0', refresh_token: 'RT0', expires_at: inMinutes(30) };
    await settle(fortnoxGet('/settings/company'));
    expect(tokenCalls).toHaveLength(0);
    expect(apiBearers).toEqual(['Bearer AT0']);
  });

  it('förnyar en utgående token, sparar den över den token den förnyade med och håller instansen vid liv', async () => {
    tokenReplies = [rotated(1)];
    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeUndefined();
    expect(h.db.row).toMatchObject({ access_token: 'AT1', refresh_token: 'RT1', expires_at: inMinutes(60) });
    // Anspråket togs innan Fortnox anropades.
    expect(h.db.row?.refresh_claimed_at).toBe(NOW.toISOString());
    expect(apiBearers).toEqual(['Bearer AT1']);
    // Ett cachat svar från token-ändpunkten vore en refresh-token som Fortnox redan förbrukat.
    expect(tokenCalls[0].cache).toBe('no-store');
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
  });

  // Anspråket i databasen hade också stoppat en andra förnyelse, men då genom att läsa om raden var 250:e ms. I samma
  // process väntar den andra på samma löfte: två läsningar i getValidAccessToken, en i refreshAndPersist.
  it('förnyar en gång per process, och den andra anroparen väntar på samma förnyelse', async () => {
    tokenReplies = [rotated(1)];
    const { error } = await settle(Promise.all([fortnoxGet('/a'), fortnoxGet('/b')]));
    expect(error).toBeUndefined();
    expect(tokenCalls).toHaveLength(1);
    expect(h.db.reads).toBe(3);
    expect(apiBearers).toEqual(['Bearer AT1', 'Bearer AT1']);
  });

  // Det som bröt kedjan: två instanser som förnyar i samma ögonblick får BÅDA nya tokens, men bara det senast utdelade
  // paret gäller. Den som inte får anspråket ska aldrig själv gå till Fortnox, utan vänta in den andras token.
  it('väntar in en annan instans som håller anspråket och använder dess token', async () => {
    h.db.row = { access_token: 'AT0', refresh_token: 'RT0', expires_at: inMinutes(-10), refresh_claimed_at: NOW.toISOString() };
    // Läsning 1 = getValidAccessToken, 2 och 3 = anspråket hålls, 4 = den andra har sparat.
    h.db.onRead = (read) => {
      if (read === 4) h.db.row = { access_token: 'AT1', refresh_token: 'RT1', expires_at: inMinutes(60), refresh_claimed_at: NOW.toISOString() };
    };

    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeUndefined();
    expect(tokenCalls).toHaveLength(0);
    expect(apiBearers).toEqual(['Bearer AT1']);
  });

  // Anspråket tas bara på den refresh-token vi läste. Har en annan instans hunnit spara mellan läsningen och anspråket
  // hade ett anspråk på RADEN skickat den redan förbrukade tokenen till Fortnox.
  it('läser om i stället för att förnya när någon sparade mellan läsningen och anspråket', async () => {
    h.db.afterRead = (read) => {
      if (read === 2) h.db.row = { access_token: 'AT1', refresh_token: 'RT1', expires_at: inMinutes(60) };
    };
    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeUndefined();
    expect(tokenCalls).toHaveLength(0);
    expect(apiBearers).toEqual(['Bearer AT1']);
  });

  it('tar över ett anspråk som övergivits', async () => {
    tokenReplies = [rotated(1)];
    h.db.row = { access_token: 'AT0', refresh_token: 'RT0', expires_at: inMinutes(-10), refresh_claimed_at: inMinutes(-0.5) };
    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeUndefined();
    expect(tokenCalls).toHaveLength(1);
    expect(h.db.row?.refresh_token).toBe('RT1');
  });

  it('ger upp när en annan instans aldrig blir klar', async () => {
    // Anspråket förnyas hela tiden: det blir aldrig övergivet.
    h.db.onRead = () => {
      if (h.db.row) h.db.row.refresh_claimed_at = new Date().toISOString();
    };
    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeInstanceOf(FortnoxApiError);
    expect((error as FortnoxApiError).status).toBe(503);
    expect(tokenCalls).toHaveLength(0);
  });

  // Koden kan nå prod före migreringen. Då ska den förnya som förut, inte stänga ute Fortnox.
  it('förnyar som förut, utan lås, när kolumnen inte finns än', async () => {
    tokenReplies = [rotated(1)];
    h.db.claimColumnMissing = true;
    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeUndefined();
    expect(h.db.row?.refresh_token).toBe('RT1');
    expect(apiBearers).toEqual(['Bearer AT1']);
  });

  it('släpper anspråket när förnyelsen misslyckas', async () => {
    tokenReplies = [{ status: 503, body: { error: 'temporarily_unavailable' } }];
    await settle(fortnoxGet('/settings/company'));
    expect(h.db.row?.refresh_claimed_at).toBeNull();
  });

  // Utan anspråket (en instans med den gamla koden under en deploy, eller ett anspråk som togs över för tidigt): Fortnox
  // nekar den andra (~0,2 s) innan den första ens fått svar (~0,7 s). Den andra ska vänta in den förstas sparande och
  // använda dess token, inte kasta "Något gick fel mot Fortnox".
  it('tar den token en annan instans sparade när Fortnox nekar vår som förbrukad', async () => {
    tokenReplies = [invalidGrant];
    // Läsning 1 = getValidAccessToken, 2 = refreshAndPersist, 3 = första omläsningen (efter 250 ms), 4 = efter 750 ms.
    h.db.onRead = (read) => {
      if (read === 4) h.db.row = { access_token: 'AT1', refresh_token: 'RT1', expires_at: inMinutes(60) };
    };

    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeUndefined();
    expect(apiBearers).toEqual(['Bearer AT1']);
    expect(h.db.row?.refresh_token).toBe('RT1');
  });

  it('säger att kopplingen måste göras om när ingen sparar en ny token', async () => {
    tokenReplies = [invalidGrant];
    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeInstanceOf(FortnoxConnectionExpiredError);
    // Varje ställe som redan fångar Fortnox-fel ska fortsätta göra det.
    expect(error).toBeInstanceOf(FortnoxApiError);
    expect(friendlyFortnoxMessage(error)).toContain('koppla från och ansluta Fortnox igen');
    expect(apiBearers).toHaveLength(0);
    expect(h.db.row?.refresh_token).toBe('RT0');
  });

  it('väntar inte på någon annan instans vid andra förnyelsefel', async () => {
    tokenReplies = [{ status: 500, body: { error: 'server_error' } }];
    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeInstanceOf(FortnoxApiError);
    expect(error).not.toBeInstanceOf(FortnoxConnectionExpiredError);
    expect(h.db.reads).toBe(2);
  });

  // Fortnox har redan förbrukat RT0 när sparandet görs. Tappas det ligger kedjan död i databasen.
  it('gör om ett sparande som misslyckas', async () => {
    tokenReplies = [rotated(1)];
    h.db.persistErrors = ['PGRST002'];
    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeUndefined();
    expect(h.db.row?.refresh_token).toBe('RT1');
  });

  it('lämnar en ny koppling orörd om någon kopplade om under förnyelsen', async () => {
    tokenReplies = [
      {
        ...rotated(1),
        before: () => {
          h.db.row = { access_token: 'ATny', refresh_token: 'RTny', expires_at: inMinutes(60) };
        },
      },
    ];
    const { error } = await settle(fortnoxGet('/settings/company'));

    expect(error).toBeUndefined();
    expect(h.db.row?.refresh_token).toBe('RTny');
    // Vår access-token gäller ändå i en timme; Fortnox drar inte in den.
    expect(apiBearers).toEqual(['Bearer AT1']);
  });
});
