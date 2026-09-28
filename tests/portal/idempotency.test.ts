import { describe, it, expect } from 'vitest';
import {
  IDEMPOTENCY_KEY_HEADER,
  STALE_CLAIM_MS,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  decideExistingIdempotencyKey,
  idempotencyRequestHash,
  isCacheableResponseStatus,
  isValidIdempotencyKey,
  type IdempotencyRow,
} from '@/lib/domains/portal/idempotency';

const NOW = new Date('2026-09-28T08:00:00.000Z');
const HASH = 'a'.repeat(64);

function row(overrides: Partial<IdempotencyRow> = {}): IdempotencyRow {
  return {
    key: 'job-q-2026-015',
    request_hash: HASH,
    status: 'processing',
    response_status: null,
    response_body: null,
    claimed_at: new Date(NOW.getTime() - 5_000).toISOString(),
    ...overrides,
  };
}

describe('isValidIdempotencyKey', () => {
  it('godtar kontraktets nycklar', () => {
    for (const key of ['job-q-2026-015', 'message-msg-1', 'store-order-so-b-2026-003-withdraw', 'pricelist-2026-10-01-ab12']) {
      expect(isValidIdempotencyKey(key)).toBe(true);
    }
  });

  it('nekar tomt, blanksteg, icke-ASCII och för långt', () => {
    for (const key of [null, undefined, '', 'job q', 'jöb-1', 'x'.repeat(201), 'job-1\n']) {
      expect(isValidIdempotencyKey(key)).toBe(false);
    }
  });

  it('heter som i kontraktet', () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe('Idempotency-Key');
  });
});

describe('idempotencyRequestHash', () => {
  const body = '{"messageId":"msg-1","body":"Hej från Gävle"}';

  it('är sha256 av metod, sökväg och kropp, räknad oberoende med Python', () => {
    expect(idempotencyRequestHash('POST', '/api/portal/jobs/q-2026-015/messages', body)).toBe(
      '3f916a5b782cfb724f3f1f2502bba8ada6b1d7a3a5c695cf774e1b3cfa8a8121',
    );
    expect(idempotencyRequestHash('post', '/api/portal/jobs/q-2026-015/messages', new TextEncoder().encode(body))).toBe(
      '3f916a5b782cfb724f3f1f2502bba8ada6b1d7a3a5c695cf774e1b3cfa8a8121',
    );
  });

  it('en annan route eller kropp ger ett annat fingeravtryck', () => {
    const base = idempotencyRequestHash('POST', '/api/portal/jobs', body);
    expect(idempotencyRequestHash('POST', '/api/portal/store-orders', body)).not.toBe(base);
    expect(idempotencyRequestHash('PUT', '/api/portal/jobs', body)).not.toBe(base);
    expect(idempotencyRequestHash('POST', '/api/portal/jobs', `${body} `)).not.toBe(base);
  });
});

describe('decideExistingIdempotencyKey', () => {
  it('samma nyckel med en annan förfrågan är ett fel (422), inte ett omförsök', () => {
    expect(decideExistingIdempotencyKey(row({ request_hash: 'b'.repeat(64) }), HASH, NOW)).toEqual({ kind: 'mismatch' });
    // Också när svaret redan finns: ett sparat svar får aldrig ges till en annan förfrågan.
    expect(
      decideExistingIdempotencyKey(row({ request_hash: 'b'.repeat(64), status: 'done', response_status: 201 }), HASH, NOW),
    ).toEqual({ kind: 'mismatch' });
  });

  it('ett klart svar spelas upp igen, med samma kod och kropp', () => {
    expect(
      decideExistingIdempotencyKey(row({ status: 'done', response_status: 201, response_body: { crmWorkOrderId: 'wo-1' } }), HASH, NOW),
    ).toEqual({ kind: 'replay', status: 201, body: { crmWorkOrderId: 'wo-1' } });
  });

  it('en färsk claim betyder att ett annat anrop håller på', () => {
    expect(decideExistingIdempotencyKey(row(), HASH, NOW)).toEqual({ kind: 'in_progress' });
  });

  it('en gammal claim får tas över — annars hade en död route låst nyckeln för alltid', () => {
    const old = new Date(NOW.getTime() - STALE_CLAIM_MS).toISOString();
    expect(decideExistingIdempotencyKey(row({ claimed_at: old }), HASH, NOW)).toEqual({ kind: 'take_over' });
    expect(decideExistingIdempotencyKey(row({ claimed_at: 'inte en tid' }), HASH, NOW)).toEqual({ kind: 'take_over' });
  });
});

describe('isCacheableResponseStatus', () => {
  it('sparar 2xx och bestående 4xx — de blir samma vid ett omförsök', () => {
    for (const status of [200, 201, 204, 400, 404, 409, 422]) expect(isCacheableResponseStatus(status)).toBe(true);
  });

  it('🧨 sparar aldrig ett tillfälligt svar: då hade varje omförsök fått samma 401 eller 429 för gott', () => {
    for (const status of [401, 408, 425, 429, 301, 302, 500, 503, 199, 600]) expect(isCacheableResponseStatus(status)).toBe(false);
  });
});

describe('completeIdempotencyKey', () => {
  it('vägrar spara ett svar som ska köras om — nyckeln ska släppas i stället', async () => {
    const admin = {} as never;
    const claim = { key: 'job-1', token: NOW.toISOString() };
    await expect(completeIdempotencyKey(admin, claim, 500, {})).rejects.toThrow(/releaseIdempotencyKey/);
    await expect(completeIdempotencyKey(admin, claim, 429, {})).rejects.toThrow(/releaseIdempotencyKey/);
    await expect(completeIdempotencyKey(admin, claim, 401, {})).rejects.toThrow(/releaseIdempotencyKey/);
  });
});

/** En service-roll-klient som spelar in filtren och svarar med `rows` på varje skrivning. */
function recordingAdmin(rows: unknown[]) {
  const filters: [string, unknown][] = [];
  const chain: Record<string, unknown> = {};
  for (const op of ['update', 'delete', 'select']) chain[op] = () => chain;
  chain.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return chain;
  };
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return { admin: { from: () => chain } as never, filters };
}

describe('completeIdempotencyKey och releaseIdempotencyKey — bara den egna claimen', () => {
  const claim = { key: 'job-1', token: '2026-09-28T08:00:00.000Z' };

  it('🧨 filtrerar på claimens token, så att en övertagen nyckel inte skrivs över eller släpps', async () => {
    for (const run of [
      (admin: never) => completeIdempotencyKey(admin, claim, 201, {}),
      (admin: never) => releaseIdempotencyKey(admin, claim),
    ]) {
      const { admin, filters } = recordingAdmin([{ key: 'job-1' }]);
      expect(await run(admin)).toBe(true);
      expect(filters).toEqual([
        ['key', 'job-1'],
        ['status', 'processing'],
        ['claimed_at', claim.token],
      ]);
    }
  });

  it('säger till när claimen inte längre var vår — PostgREST svarar utan fel på noll rader', async () => {
    const { admin } = recordingAdmin([]);
    expect(await completeIdempotencyKey(admin, claim, 201, {})).toBe(false);
    expect(await releaseIdempotencyKey(recordingAdmin([]).admin, claim)).toBe(false);
  });
});
