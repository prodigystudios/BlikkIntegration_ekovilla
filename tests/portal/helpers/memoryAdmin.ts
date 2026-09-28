/**
 * En Supabase-klient i minnet, för de frågeformer portalens databassteg använder: select/insert/upsert/update/delete
 * med eq/is/in/not-is/lt/lte/gt, order och limit, `.select()` för att få tillbaka raderna och `.maybeSingle()`. Beter
 * sig som PostgREST där det spelar roll för koden som prövas:
 *   - en UPDATE eller DELETE som inte träffar någon rad svarar utan fel, med en tom lista;
 *   - `upsert` med `ignoreDuplicates` lämnar en befintlig rad orörd och svarar med en tom lista;
 *   - en krock på en unik kolumn svarar med kod 23505.
 * Kolumnlistan i `select` läses inte: hela raden kommer tillbaka. Inbäddningar (`contacts:…`) ligger redan på raden.
 * portal_outbound_events får kolumnens standardvärden vid insert: ett stigande `seq`, status 'pending' och 0 försök.
 * lt/lte/gt jämför värdena som de står: ISO-tider i samma form, eller tal.
 *
 * `failOn` låter ett test få en fråga att svara med ett fel, en gång eller varje gång. `canUpdate` spelar RLS på
 * UPDATE: en rad den säger nej till ändras inte och kommer inte tillbaka, utan fel, som i PostgREST. `beforeExecute`
 * körs före varje fråga, med tabellerna: så spelar ett test upp något som en annan hann göra i samma stund.
 */

type Row = Record<string, unknown>;
type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';
type Filter = ['eq' | 'is' | 'in' | 'notIs' | 'lt' | 'lte' | 'gt', string, unknown];
export type Call = {
  table: string;
  op: Op;
  values?: unknown;
  filters: Filter[];
  options?: Record<string, unknown>;
  order?: { column: string; ascending: boolean };
  limit?: number;
};
type DbError = { code?: string; message: string };

const UNIQUE: Record<string, string[]> = {
  crm_portal_jobs: ['quote_id', 'reserved_work_order_id', 'work_order_id'],
  crm_portal_resellers: ['reseller_id'],
  crm_work_orders: ['id', 'order_number'],
  portal_idempotency_keys: ['key'],
  portal_outbound_events: ['idempotency_key'],
};

export function memoryAdmin(
  initial: Record<string, Row[]> = {},
  options: {
    canUpdate?: (table: string, row: Row) => boolean;
    beforeExecute?: (call: Call, tables: Record<string, Row[]>) => void;
  } = {},
) {
  const tables: Record<string, Row[]> = structuredClone(initial);
  let nextSeq = Math.max(0, ...(tables.portal_outbound_events ?? []).map((r) => Number(r.seq ?? 0))) + 1;
  const withDefaults = (table: string, row: Row): Row =>
    table === 'portal_outbound_events'
      ? { status: 'pending', attempts: 0, ...row, seq: row.seq ?? nextSeq++ }
      : row;
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
      if (kind === 'lt' || kind === 'lte' || kind === 'gt') {
        if (actual === null) return false;
        const a = actual as string | number;
        const b = value as string | number;
        return kind === 'lt' ? a < b : kind === 'lte' ? a <= b : a > b;
      }
      return actual === value;
    });

  function conflict(table: string, candidate: Row, except?: Row): DbError | null {
    for (const column of UNIQUE[table] ?? []) {
      const value = candidate[column];
      if (value == null) continue;
      if (rowsOf(table).some((r) => r !== except && r[column] === value)) {
        return { code: '23505', message: `duplicate key value violates unique constraint "${table}_${column}_key"` };
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
      if (call.order) {
        const { column, ascending } = call.order;
        rows = [...rows].sort((x, y) => {
          const a = x[column] as string | number;
          const b = y[column] as string | number;
          return (a < b ? -1 : a > b ? 1 : 0) * (ascending ? 1 : -1);
        });
      }
      if (call.limit !== undefined) rows = rows.slice(0, call.limit);
      return out(rows);
    }

    if (call.op === 'insert' || call.op === 'upsert') {
      const values = (Array.isArray(call.values) ? call.values : [call.values]) as Row[];
      const onConflict = call.options?.onConflict as string | undefined;
      const written: Row[] = [];
      for (const value of values) {
        const existing = onConflict ? table.find((r) => r[onConflict] === value[onConflict]) : undefined;
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
      order: (column: string, options?: { ascending?: boolean }) => ((call.order = { column, ascending: options?.ascending ?? true }), chain),
      limit: (n: number) => ((call.limit = n), chain),
      maybeSingle: async () => execute(call, returning, true),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(execute(call, returning, false)).then(resolve, reject),
    };
    return chain;
  }

  return { admin: { from } as never, tables, calls, failOn };
}
