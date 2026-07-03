import { NextResponse } from 'next/server';
import { z } from 'zod';

// Shared HTTP response helpers for non-CRM API routes. Mirrors the shape used by the CRM
// surface (app/api/crm/_shared.ts) exactly — `error` is the human string the client toasts,
// `errorDetails` carries the machine-readable { code, message, details }. Kept identical so the
// whole app parses one response shape; do not introduce a third variant.

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function getFirstValidationMessage(parsedError: z.ZodError) {
  const flattened = parsedError.flatten();
  const fieldErrorGroups = Object.values(flattened.fieldErrors);

  for (const messages of fieldErrorGroups) {
    const firstMessage = messages?.find(Boolean);
    if (firstMessage) return firstMessage;
  }

  return flattened.formErrors.find(Boolean) || 'Invalid request';
}

export function validationError(parsedError: z.ZodError) {
  return routeError(400, 'validation_error', getFirstValidationMessage(parsedError), parsedError.flatten());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Guards a dynamic [id] path segment before it reaches a `.eq('id', …)` query. A non-UUID id
// otherwise makes Postgres throw 22P02, surfacing as a raw 500. Returns a 400 to return early,
// or null when the id is valid.
export function invalidUuidParam(id: string | undefined) {
  return id && UUID_RE.test(id) ? null : routeError(400, 'invalid_id', 'Ogiltigt id.');
}

// PostgREST returns PGRST116 from `.single()` when a statement matched no rows — the row is
// missing OR hidden by RLS. Lets callers answer 403/404 deliberately instead of leaking a 500.
export function isNoRowsError(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST116';
}
