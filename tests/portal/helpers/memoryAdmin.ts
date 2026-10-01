/**
 * En Supabase-klient i minnet, för de frågeformer portalens databassteg använder: select/insert/upsert/update/delete
 * med eq/is/in/not-is/lt/lte/gt, order och limit, `.select()` för att få tillbaka raderna och `.maybeSingle()`. Beter
 * sig som PostgREST där det spelar roll för koden som prövas:
 *   - en UPDATE eller DELETE som inte träffar någon rad svarar utan fel, med en tom lista;
 *   - `upsert` med `ignoreDuplicates` lämnar en befintlig rad orörd och svarar med en tom lista;
 *   - en krock på en unik kolumn svarar med kod 23505.
 * Kolumnlistan i `select` läses inte: hela raden kommer tillbaka. Inbäddningar (`contacts:…`) ligger redan på raden.
 * portal_outbound_events får kolumnens standardvärden vid insert: ett stigande `seq`, status 'pending' och 0 försök.
 * Andra tabellers standardvärden (id, tider) ger testet med `defaults`.
 * lt/lte/gt jämför värdena som de står: ISO-tider i samma form, eller tal.
 * En unik nyckel och `onConflict` kan vara sammansatta ('direction,message_id'), och `order` kan ges flera gånger.
 * `rpc` svarar med testets `rpc`-funktion; anropet står i `calls` som tabellen `rpc:<namn>` med argumenten som värden.
 *
 * `like` följer SQL: `%` är vad som helst, `_` ett tecken.
 * `storage` är en lagring i minnet (`files`, nyckeln `<bucket>/<sökväg>`): `upload` skriver aldrig över (som
 * `upsert: false`) och svarar då som Supabase ("already exists", 409); `download` svarar med en Blob, eller "Object not
 * found" (404). Anropen står i `calls` som tabellen `storage:<bucket>` (op `insert` för upload, `select` för download),
 * så att `failOn` kan få dem att falla.
 *
 * `failOn` låter ett test få en fråga att svara med ett fel, en gång eller varje gång. `canUpdate` spelar RLS på
 * UPDATE: en rad den säger nej till ändras inte och kommer inte tillbaka, utan fel, som i PostgREST. `beforeExecute`
 * körs före varje fråga, med tabellerna: så spelar ett test upp något som en annan hann göra i samma stund.
 */

type Row = Record<string, unknown>;
type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';
type Filter = ['eq' | 'neq' | 'is' | 'in' | 'notIs' | 'lt' | 'lte' | 'gt' | 'like', string, unknown];
export type Call = {
  table: string;
  op: Op;
  values?: unknown;
  filters: Filter[];
  options?: Record<string, unknown>;
  order?: { column: string; ascending: boolean };
  /** Alla `order`, i den ordning de gavs. `order` är den första. */
  orders?: { column: string; ascending: boolean }[];
  limit?: number;
  /** `range(from, to)`: raderna från `from` (0-baserat) till och med `to`. */
  offset?: number;
};
type DbError = { code?: string; message: string };

const UNIQUE: Record<string, string[]> = {
  crm_portal_jobs: ['quote_id', 'reserved_work_order_id', 'work_order_id'],
  crm_portal_job_messages: ['id', 'direction,message_id'],
  crm_portal_job_documents: ['id'],
  crm_portal_partners: ['customer_id'],
  crm_portal_reseller_invites: ['id', 'idempotency_key', 'reseller_id,attempt'],
  crm_portal_resellers: ['reseller_id'],
  crm_store_orders: ['id', 'order_id'],
  crm_work_orders: ['id', 'order_number'],
  portal_idempotency_keys: ['key'],
  portal_outbound_events: ['idempotency_key'],
};

export function memoryAdmin(
  initial: Record<string, Row[]> = {},
  options: {
    canUpdate?: (table: string, row: Row) => boolean;
    beforeExecute?: (call: Call, tables: Record<string, Row[]>) => void;
    /** Kolumnernas standardvärden vid insert, per tabell (det databasen hade fyllt i). */
    defaults?: (table: string, row: Row) => Row;
    /** Svaret på en RPC. Utan den svarar varje RPC med ett fel. */
    rpc?: (name: string, args: Record<string, unknown>, tables: Record<string, Row[]>) => unknown;
  } = {},
) {
  const tables: Record<string, Row[]> = structuredClone(initial);
  let nextSeq = Math.max(0, ...(tables.portal_outbound_events ?? []).map((r) => Number(r.seq ?? 0))) + 1;
  const withDefaults = (table: string, row: Row): Row => {
    const filled = { ...(options.defaults?.(table, row) ?? {}), ...row };
    return table === 'portal_outbound_events'
      ? { status: 'pending', attempts: 0, ...filled, seq: filled.seq ?? nextSeq++ }
      : filled;
  };
  // En sammansatt nyckel ('direction,message_id') är samma när varje kolumn är det.
  const columnsOf = (key: string) => key.split(',').map((c) => c.trim());
  const sameKey = (a: Row, b: Row, key: string) => columnsOf(key).every((c) => a[c] === b[c]);
  const calls: Call[] = [];
  const failures: { match: (call: Call) => boolean; error: DbError; times: number }[] = [];

  function failOn(match: (call: Call) => boolean, error: DbError, times = 1) {
    failures.push({ match, error, times });
  }

  const rowsOf = (table: string) => (tables[table] ??= []);
  const matches = (row: Row, filters: Filter[]) =>
    filters.every(([kind, column, value]) => {
      const actual = row[column] ?? null;
      if (kind === 'in') return (value as unknown[]).includes(actual);
      if (kind === 'notIs') return actual !== value;
      // Som i SQL: `<>` mot NULL är aldrig sant.
      if (kind === 'neq') return actual !== null && actual !== value;
      if (kind === 'like') {
        if (typeof actual !== 'string') return false;
        const pattern = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp(`^${pattern}$`, 's').test(actual);
      }
      if (kind === 'lt' || kind === 'lte' || kind === 'gt') {
        if (actual === null) return false;
        const a = actual as string | number;
        const b = value as string | number;
        return kind === 'lt' ? a < b : kind === 'lte' ? a <= b : a > b;
      }
      return actual === value;
    });

  function conflict(table: string, candidate: Row, except?: Row): DbError | null {
    for (const key of UNIQUE[table] ?? []) {
      if (columnsOf(key).some((c) => candidate[c] == null)) continue;
      if (rowsOf(table).some((r) => r !== except && sameKey(r, candidate, key))) {
        return { code: '23505', message: `duplicate key value violates unique constraint "${table}_${key.replace(/,/g, '_')}_key"` };
      }
    }
    return null;
  }

  function execute(call: Call, returning: boolean, single: boolean): { data: unknown; error: DbError | null } {
    calls.push(call);
    options.beforeExecute?.(call, tables);
    const failure = failures.find((f) => f.times > 0 && f.match(call));
    if (failure) {
      failure.times -= 1;
      return { data: null, error: failure.error };
    }
    const table = rowsOf(call.table);
    const out = (rows: Row[]) => {
      const copies = rows.map((r) => structuredClone(r));
      return { data: returning || call.op === 'select' ? (single ? (copies[0] ?? null) : copies) : null, error: null };
    };

    if (call.op === 'select') {
      let rows = table.filter((r) => matches(r, call.filters));
      const orders = call.orders ?? (call.order ? [call.order] : []);
      if (orders.length > 0) {
        rows = [...rows].sort((x, y) => {
          for (const { column, ascending } of orders) {
            const a = x[column] as string | number;
            const b = y[column] as string | number;
            if (a !== b) return (a < b ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
      }
      if (call.offset !== undefined) rows = rows.slice(call.offset);
      if (call.limit !== undefined) rows = rows.slice(0, call.limit);
      return out(rows);
    }

    if (call.op === 'insert' || call.op === 'upsert') {
      const values = (Array.isArray(call.values) ? call.values : [call.values]) as Row[];
      const onConflict = call.options?.onConflict as string | undefined;
      const written: Row[] = [];
      for (const value of values) {
        const existing = onConflict ? table.find((r) => sameKey(r, value, onConflict)) : undefined;
        if (call.op === 'upsert' && existing) {
          if (call.options?.ignoreDuplicates) continue;
          const merged = { ...existing, ...value };
          const clash = conflict(call.table, merged, existing);
          if (clash) return { data: null, error: clash };
          Object.assign(existing, value);
          written.push(existing);
          continue;
        }
        const clash = conflict(call.table, value);
        if (clash) return { data: null, error: clash };
        const row = withDefaults(call.table, structuredClone(value));
        table.push(row);
        written.push(row);
      }
      return out(written);
    }

    const hit = table.filter(
      (r) => matches(r, call.filters) && (call.op !== 'update' || (options.canUpdate?.(call.table, r) ?? true)),
    );
    if (call.op === 'update') {
      for (const row of hit) {
        const clash = conflict(call.table, { ...row, ...(call.values as Row) }, row);
        if (clash) return { data: null, error: clash };
      }
      for (const row of hit) Object.assign(row, call.values as Row);
      return out(hit);
    }
    tables[call.table] = table.filter((r) => !hit.includes(r));
    return out(hit);
  }

  function from(tableName: string) {
    const call: Call = { table: tableName, op: 'select', filters: [] };
    let returning = false;
    const chain = {
      select: () => ((returning = true), chain),
      insert: (values: unknown) => ((call.op = 'insert'), (call.values = values), chain),
      upsert: (values: unknown, options?: Record<string, unknown>) => ((call.op = 'upsert'), (call.values = values), (call.options = options), chain),
      update: (values: unknown) => ((call.op = 'update'), (call.values = values), chain),
      delete: () => ((call.op = 'delete'), chain),
      eq: (column: string, value: unknown) => (call.filters.push(['eq', column, value]), chain),
      neq: (column: string, value: unknown) => (call.filters.push(['neq', column, value]), chain),
      is: (column: string, value: unknown) => (call.filters.push(['is', column, value]), chain),
      in: (column: string, values: unknown[]) => (call.filters.push(['in', column, values]), chain),
      not: (column: string, operator: string, value: unknown) => {
        if (operator !== 'is') throw new Error(`memoryAdmin: not.${operator} stöds inte`);
        call.filters.push(['notIs', column, value]);
        return chain;
      },
      lt: (column: string, value: unknown) => (call.filters.push(['lt', column, value]), chain),
      lte: (column: string, value: unknown) => (call.filters.push(['lte', column, value]), chain),
      gt: (column: string, value: unknown) => (call.filters.push(['gt', column, value]), chain),
      like: (column: string, value: unknown) => (call.filters.push(['like', column, value]), chain),
      order: (column: string, options?: { ascending?: boolean }) => {
        const order = { column, ascending: options?.ascending ?? true };
        call.order ??= order;
        (call.orders ??= []).push(order);
        return chain;
      },
      limit: (n: number) => ((call.limit = n), chain),
      range: (from: number, to: number) => ((call.offset = from), (call.limit = to - from + 1), chain),
      maybeSingle: async () => execute(call, returning, true),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(execute(call, returning, false)).then(resolve, reject),
    };
    return chain;
  }

  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const call: Call = { table: `rpc:${name}`, op: 'select', values: args, filters: [] };
    calls.push(call);
    const failure = failures.find((f) => f.times > 0 && f.match(call));
    if (failure) {
      failure.times -= 1;
      return { data: null, error: failure.error };
    }
    if (!options.rpc) return { data: null, error: { message: `memoryAdmin: ingen rpc ${name}` } };
    return { data: options.rpc(name, args, tables), error: null };
  }

  const files = new Map<string, Uint8Array>();
  const storage = {
    from(bucket: string) {
      const fail = (op: Op, path: string) => {
        const call: Call = { table: `storage:${bucket}`, op, values: path, filters: [] };
        calls.push(call);
        const failure = failures.find((f) => f.times > 0 && f.match(call));
        if (!failure) return null;
        failure.times -= 1;
        return failure.error;
      };
      return {
        async upload(path: string, body: Uint8Array | ArrayBuffer, opts?: { upsert?: boolean }) {
          const error = fail('insert', path);
          if (error) return { data: null, error };
          const key = `${bucket}/${path}`;
          if (files.has(key) && !opts?.upsert) {
            return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
          }
          files.set(key, new Uint8Array(body instanceof ArrayBuffer ? body : body.slice()));
          return { data: { path }, error: null };
        },
        async download(path: string) {
          const error = fail('select', path);
          if (error) return { data: null, error };
          const bytes = files.get(`${bucket}/${path}`);
          if (!bytes) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
          return { data: new Blob([bytes.slice()]), error: null };
        },
      };
    },
  };

  return { admin: { from, rpc, storage } as never, tables, calls, failOn, files };
}
